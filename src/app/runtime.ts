import crypto from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CliResult } from "../cli/output.js";
import { errorResult } from "../cli/output.js";
import {
  getProjectConfigPath,
  parseProjectConfig,
  emptyProjectConfig
} from "../config/project-config.js";
import {
  getUserConfigPath,
  parseUserConfig,
  emptyUserConfig,
  type ProviderConfig,
  type UserConfig,
  type UserConfigInput
} from "../config/user-config.js";
import { resolveInside } from "../domain/path-guard.js";
import { createTaxonomy, type Taxonomy } from "../domain/taxonomy.js";
import type { SqliteIndex, UsageEvent } from "../adapters/sqlite-index.js";
import type { SidecarStore, Sidecar } from "../adapters/sidecar-store.js";
import { StorageRootGuard, fsyncDirectoryHonest } from "../adapters/storage-root-guard.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import { OpenAICompatTextRanker } from "../adapters/vision/text-ranker-openai-compat.js";
import { getVisionProviderPreset, type VisionProviderId } from "../adapters/vision/presets.js";

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".tif",
  ".tiff"
]);

export type ServiceOutcome = {
  result: CliResult;
  exitCode: number;
};

export type ResolvedProviderConfig = {
  id: VisionProviderId;
  endpoint: string;
  model: string;
  apiKey: string;
};

type ResolveProviderConfigOptions = {
  /**
   * Project config is repository-controlled, while provider API keys are
   * user-scoped. Keep this true for legacy analyze behavior, but disable it for
   * text ranking so a checked-in endpoint cannot route a user's key elsewhere.
   */
  allowProjectEndpointOverride?: boolean;
};

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

export function toPosixRel(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

export function extensionWithoutDot(filePath: string): string {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  return ext === "jpeg" ? "jpg" : ext;
}

export async function readProjectConfig(root: string) {
  const configPath = getProjectConfigPath(root);
  // Validate the config path (and its parent chain) stays inside the project
  // root before reading — a pre-existing `.img-ia` symlink/junction must not
  // redirect config reads outside root.
  const guard = new StorageRootGuard(root);
  let resolvedConfigPath: string;
  try {
    resolvedConfigPath = await guard.ensureInside(configPath, true);
  } catch (error) {
    // A genuinely missing config file (ENOENT from lstat/realpath on a
    // not-yet-existing path) is a normal "no project config" state and
    // maps to an empty config. Any OTHER failure — especially a
    // StorageRootGuardError indicating the config path escapes root via a
    // symlink/junction/reparse point — MUST surface so callers like
    // `doctorService` report the check as failed/not-ok instead of
    // silently treating a tampered/escaping config path as missing.
    if (isNodeError(error) && error.code === "ENOENT") {
      return emptyProjectConfig();
    }
    throw error;
  }
  const raw = await readJsonIfExists(resolvedConfigPath);
  return raw === undefined ? emptyProjectConfig() : parseProjectConfig(raw);
}

export async function readUserConfig(configPath = getUserConfigPath()): Promise<UserConfig> {
  const raw = await readJsonIfExists(configPath);
  return raw === undefined ? emptyUserConfig() : parseUserConfig(raw);
}

export async function resolveProviderConfig(
  root: string,
  options: ResolveProviderConfigOptions = {}
): Promise<ResolvedProviderConfig> {
  const user = await readUserConfig();
  const project = await readProjectConfig(root);
  const id = (project.provider?.provider ?? user.activeProvider) as VisionProviderId;
  const preset = getVisionProviderPreset(id);
  const userProvider = user.providers[id];
  const apiKey = userProvider?.apiKey;
  if (!apiKey) throw new Error(`Missing per-user API key for provider: ${id}`);

  const userOrPresetEndpoint = userProvider.endpoint ?? preset.endpoint;
  if (options.allowProjectEndpointOverride === false) {
    rejectUntrustedProjectEndpoint(project.provider, userOrPresetEndpoint);
  }

  return {
    id,
    endpoint:
      options.allowProjectEndpointOverride === false
        ? userOrPresetEndpoint
        : (project.provider?.endpoint ?? userOrPresetEndpoint),
    model: project.provider?.model ?? userProvider.model ?? preset.defaultModel,
    apiKey
  };
}

export async function buildTextRankerProvider(root: string): Promise<OpenAICompatTextRanker> {
  const provider = await resolveProviderConfig(root, { allowProjectEndpointOverride: false });
  return new OpenAICompatTextRanker({
    id: provider.id,
    endpoint: provider.endpoint,
    model: provider.model,
    apiKey: provider.apiKey
  });
}

function rejectUntrustedProjectEndpoint(
  projectProvider: Pick<ProviderConfig, "endpoint"> | undefined,
  trustedEndpoint: string
): void {
  if (
    projectProvider?.endpoint === undefined ||
    normalizeProviderEndpoint(projectProvider.endpoint) ===
      normalizeProviderEndpoint(trustedEndpoint)
  ) {
    return;
  }
  throw new Error(
    "Project provider endpoint overrides are not trusted for text ranking; configure custom endpoints in user config so the endpoint and API key share the same trust boundary."
  );
}

function normalizeProviderEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

export async function writeUserConfig(
  config: UserConfig | UserConfigInput,
  configPath = getUserConfigPath()
): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(parseUserConfig(config), null, 2)}\n`, {
    mode: 0o600
  });
}

export type ResolvedUnsplashCredential = {
  accessKey: string;
  source: "env" | "user-config";
};

export type ResolvedPixabayCredential = { apiKey: string; source: "env" | "user-config" };

/**
 * Resolves the Unsplash Access Key with explicit precedence:
 *
 * 1. `UNSPLASH_ACCESS_KEY` environment variable — explicit override for
 *    automation/CI; never persisted by the CLI.
 * 2. User-scoped config `unsplash.accessKey` — the persistent private flow
 *    written by `smart-img config unsplash setup`.
 *
 * Project config is intentionally never consulted: project config rejects
 * secret-looking values at parse time, and credentials must not leak into
 * repository-controlled files.
 *
 * Throws `MissingUnsplashCredentialError` when neither source provides a key
 * so callers (`pick --source unsplash`, `UnsplashClient`) can surface a
 * structured, actionable, secret-free error.
 */
export async function resolveUnsplashCredential(
  configPath: string = getUserConfigPath(),
  env: NodeJS.ProcessEnv = process.env
): Promise<ResolvedUnsplashCredential> {
  const envKey = typeof env.UNSPLASH_ACCESS_KEY === "string" ? env.UNSPLASH_ACCESS_KEY.trim() : "";
  if (envKey.length > 0) {
    return { accessKey: envKey, source: "env" };
  }

  const user = await readUserConfig(configPath);
  const configKey = user.unsplash.accessKey?.trim();
  if (configKey && configKey.length > 0) {
    return { accessKey: configKey, source: "user-config" };
  }

  throw new MissingUnsplashCredentialError();
}

/** Resolve Pixabay key: `PIXABAY_API_KEY` env > user-config `pixabay.apiKey`. */
export async function resolvePixabayApiKey(
  configPath: string = getUserConfigPath(),
  env: NodeJS.ProcessEnv = process.env
): Promise<ResolvedPixabayCredential> {
  const envKey = typeof env.PIXABAY_API_KEY === "string" ? env.PIXABAY_API_KEY.trim() : "";
  if (envKey.length > 0) return { apiKey: envKey, source: "env" };

  const configKey = (await readUserConfig(configPath)).pixabay.apiKey?.trim();
  if (configKey && configKey.length > 0) return { apiKey: configKey, source: "user-config" };

  throw new MissingPixabayCredentialError();
}

/**
 * Structured error thrown when `--source unsplash` is used without a
 * configured Access Key. Carries actionable, secret-free guidance so the
 * CLI/service layer can emit it verbatim without inventing instructions.
 */
export class MissingUnsplashCredentialError extends Error {
  constructor() {
    super("Unsplash Access Key is not configured.");
    this.name = "MissingUnsplashCredentialError";
  }

  get guidance(): {
    reason: "missing_unsplash_credential";
    obtain: string;
    setupCommand: string;
    retry: string;
  } {
    return {
      reason: "missing_unsplash_credential",
      obtain:
        "Obtain an Unsplash Access Key at https://unsplash.com/developers (Your apps → New demo application).",
      setupCommand:
        "Run `smart-img config unsplash setup` in a private terminal and paste the key when prompted.",
      retry: "Retry `smart-img pick --source unsplash` after setup completes."
    };
  }
}

/** Thrown when pick/source pixabay has no env or user-config key. */
export class MissingPixabayCredentialError extends Error {
  readonly guidance = {
    reason: "missing_pixabay_credential" as const,
    obtain: "Obtain a Pixabay API key at https://pixabay.com/api/docs/.",
    setupCommand:
      "Run `smart-img config pixabay setup` in a private terminal and paste the key when prompted.",
    retry: "Retry `smart-img pick --source pixabay` after setup completes."
  };

  constructor() {
    super("Pixabay API key is not configured.");
    this.name = "MissingPixabayCredentialError";
  }
}

export async function writeProjectConfig(root: string, value: unknown): Promise<void> {
  const parsed = parseProjectConfig(value);
  const target = getProjectConfigPath(root);
  const guard = new StorageRootGuard(root);
  await guard.ensureParentInside(target);
  await fs.writeFile(target, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
}

export async function loadTaxonomy(root: string): Promise<Taxonomy> {
  const defaultTaxonomy = parseTaxonomy(await readJson(defaultTaxonomyPath()));
  const projectConfig = await readProjectConfig(root);
  return createTaxonomy(defaultTaxonomy, projectConfig.categories);
}

export async function listSidecars(store: SidecarStore): Promise<Sidecar[]> {
  // Validate the sidecar directory path (and its ancestor chain) stays
  // inside the project root — including symlink/junction/reparse-point
  // realpath semantics — BEFORE enumerating it. A pre-existing
  // `.img-ia/sidecars` symlink/junction that escapes root must be rejected
  // here so outside-root directory enumeration never happens, rather than
  // relying solely on the per-sidecar guarded reads that follow.
  let sidecarDir: string;
  try {
    sidecarDir = await store.ensureSidecarDirInside();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  let entries: string[];
  try {
    entries = await fs.readdir(sidecarDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const sidecars: Sidecar[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const sha = entry.slice(0, -".json".length);
    const sidecar = await store.read(sha);
    if (sidecar !== null) {
      sidecars.push(sidecar);
    }
  }
  return sidecars;
}

export async function ensureIndexReady(index: SqliteIndex, store: SidecarStore): Promise<void> {
  const status = index.rebuildStatus();
  if (status === "completed") {
    return;
  }
  await index.rebuildFromSidecars(await listSidecars(store));
}

export async function appendUsage(
  root: string,
  index: SqliteIndex,
  event: UsageEvent
): Promise<void> {
  const guard = new StorageRootGuard(root);
  const journal = path.join(root, ".img-ia", "usage.jsonl");
  await guard.ensureParentInside(journal);
  const line = `${JSON.stringify(event)}\n`;
  // Capture the journal size before appending so a post-journal SQL failure
  // can truncate the just-written line and avoid leaving durable usage
  // marking for an output the caller will roll back.
  const sizeBefore = await fileSize(journal);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(
      journal,
      constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY,
      0o600
    );
    await handle.write(line, undefined, "utf8");
    await handle.sync();
  } finally {
    await handle?.close().catch(() => undefined);
  }
  const dirSync = await fsyncDirectoryHonest(path.dirname(journal));
  if (!dirSync.synced && !dirSync.unsupported) {
    throw new Error(`Directory fsync failed for ${path.dirname(journal)}`);
  }
  try {
    index.recordUsageEvent(event);
  } catch (sqlError) {
    // The journal line was durably written but the SQLite index update
    // failed. Truncate the journal back to its pre-append size so a future
    // replay does not mark usage for an output the caller is about to roll
    // back. If truncation also fails, the original SQL error still
    // propagates so the caller gets an actionable failure reason.
    await fs.truncate(journal, sizeBefore).catch(() => undefined);
    throw sqlError;
  }
}

export async function validateExistingInput(root: string, candidate: string): Promise<string> {
  const absolute = resolveInside(root, candidate);
  await new StorageRootGuard(root).ensureInside(absolute, true);
  return absolute;
}

export function stableNow(): string {
  return new Date().toISOString();
}

export function serviceError(command: string, reason: string, error: unknown): CliResult {
  const message =
    error instanceof Error
      ? defaultSecretRedactor.mask(error.message)
      : defaultSecretRedactor.mask(String(error));
  return errorResult(command, reason, message);
}

async function readJsonIfExists(filePath: string): Promise<unknown | undefined> {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function defaultTaxonomyPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/categories.json");
}

function parseTaxonomy(value: unknown): Taxonomy {
  return value as Taxonomy;
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function fileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}
