import path from "node:path";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import { ModelDiscoveryClient } from "../adapters/vision/model-discovery.js";
import {
  annotateModelsWithVisionHints,
  describeVisionHint
} from "../adapters/vision/vision-hints.js";
import {
  AuthProviderError,
  EndpointNotFoundProviderError,
  ModelNotFoundProviderError,
  VisionProviderError
} from "../adapters/vision/provider.js";
import { getVisionProviderPreset, type VisionProviderId } from "../adapters/vision/presets.js";
import {
  emptyProjectConfig,
  parseProjectConfig,
  type ProjectConfig
} from "../config/project-config.js";
import type { UserConfig } from "../config/user-config.js";
import {
  readProjectConfig,
  readUserConfig,
  writeProjectConfig,
  writeUserConfig,
  isNodeError,
  type ServiceOutcome
} from "./runtime.js";
import { setupService, type SetupServiceOptions } from "./setup-service.js";
import { pixabaySetupService } from "./pixabay-setup-service.js";
import type { Prompter } from "../cli/prompter.js";

const SECRET_KEY_NAME = /(api[-_]?key|authorization|bearer|token|secret|password|credential)/i;
const API_KEY_SEGMENT = /^api[-_]?key$/i;
const PROVIDER_IDS = new Set<VisionProviderId>(["ollama", "openrouter", "gemini"]);

export type ConfigServiceOptions = {
  project?: boolean;
  root?: string;
  userConfigPath?: string;
  provider?: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  yes?: boolean;
  fetchImpl?: typeof fetch;
  prompter?: Prompter;
  isTty?: boolean;
  /** When provided, human-mode connection outcomes are written here. */
  stderr?: NodeJS.WritableStream;
};

/**
 * Masks a value retrieved by a dotted key path. When the final key segment
 * looks like a secret-named field (apiKey, token, secret, password, credential,
 * authorization, bearer), the value is redacted to "[REDACTED]" regardless of
 * its shape or length — a short non-token-shaped API key must not leak through
 * `config get providers.<id>.apiKey`. Non-secret keys fall back to the standard
 * value-shape redactor.
 */
function maskByContext(dottedKey: string, value: unknown): unknown {
  const lastSegment = dottedKey.split(".").at(-1) ?? "";
  if (SECRET_KEY_NAME.test(lastSegment)) {
    return "[REDACTED]";
  }
  return defaultSecretRedactor.maskValue(value);
}

/**
 * Reads project config, mapping a genuinely missing config file (ENOENT) to
 * an empty config and surfacing any other failure (StorageRootGuardError,
 * path escape, parse error) as a structured `invalid_input` outcome (exit 3)
 * with a redacted message. This prevents guard/path failures from being
 * silently hidden as "no project config" by `config --project list/get/set`.
 */
async function safeReadProjectConfig(
  root: string
): Promise<{ config: ProjectConfig } | { error: ServiceOutcome }> {
  try {
    return { config: await readProjectConfig(root) };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { config: emptyProjectConfig() };
    }
    const msg = defaultSecretRedactor.mask(error instanceof Error ? error.message : String(error));
    return {
      error: {
        result: errorResult("config", "invalid_input", msg),
        exitCode: EXIT_CODES.INVALID_INPUT
      }
    };
  }
}

export async function configService(
  action = "list",
  key: string | undefined,
  value: string | undefined,
  options: ConfigServiceOptions = {}
): Promise<ServiceOutcome> {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.project === true) {
    // Missing project config (ENOENT) maps to an empty config and is a normal
    // "no project config" state. Any OTHER failure — especially a
    // StorageRootGuardError indicating the config path escapes root via a
    // symlink/junction/reparse point — MUST surface as a structured failure
    // (exit non-zero, redacted message) instead of being silently swallowed
    // as an empty config.
    const readOutcome = await safeReadProjectConfig(root);
    if ("error" in readOutcome) {
      return readOutcome.error;
    }
    const current: ProjectConfig = readOutcome.config;
    if (action === "list")
      return {
        result: successResult("config", {
          scope: "project",
          config: defaultSecretRedactor.maskValue(current)
        }),
        exitCode: EXIT_CODES.SUCCESS
      };
    if (action === "get" && key) {
      try {
        return {
          result: successResult("config", {
            key,
            value: maskByContext(key, getPath(current, key))
          }),
          exitCode: EXIT_CODES.SUCCESS
        };
      } catch (error) {
        return invalidKey(error);
      }
    }
    if (action === "set" && key && value !== undefined) {
      if (isUnsplashConfigKey(key)) {
        return unsplashSetBlocked();
      }
      if (isPixabayConfigKey(key)) {
        return pixabaySetBlocked();
      }
      try {
        const next = setPath(
          structuredClone(current) as Record<string, unknown>,
          key,
          parseValue(value)
        );
        await writeProjectConfig(root, parseProjectConfig(next));
        return {
          result: successResult("config", {
            scope: "project",
            key,
            value: maskByContext(key, getPath(next, key))
          }),
          exitCode: EXIT_CODES.SUCCESS
        };
      } catch (error) {
        return invalidKey(error);
      }
    }
    return invalid();
  }

  const userConfigPath = options.userConfigPath;
  const current = await readUserConfig(userConfigPath);

  if (action === "setup") {
    const setupOptions: SetupServiceOptions = {
      ...(options.provider !== undefined ? { provider: options.provider } : {}),
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
      ...(options.yes !== undefined ? { yes: options.yes } : {}),
      ...(userConfigPath !== undefined ? { userConfigPath } : {}),
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.prompter !== undefined ? { prompter: options.prompter } : {}),
      ...(options.isTty !== undefined ? { isTty: options.isTty } : {}),
      ...(options.stderr !== undefined ? { stderr: options.stderr } : {})
    };
    return setupService(setupOptions);
  }
  // Unsplash setup dispatch removed (WU6b1). Service module retained until WU6b2.
  // `config unsplash setup` falls through to generic invalid_input (no guidance).
  if (action === "pixabay" && key === "setup") {
    // Shared optional [value] positional must not accept argv secrets.
    // Reject any defined value before the private prompt; never inspect it.
    if (value !== undefined) {
      return pixabaySetBlocked();
    }
    return pixabaySetupService({
      ...(userConfigPath !== undefined ? { userConfigPath } : {}),
      ...(options.prompter !== undefined ? { prompter: options.prompter } : {}),
      ...(options.isTty !== undefined ? { isTty: options.isTty } : {}),
      ...(options.stderr !== undefined ? { stderr: options.stderr } : {})
    });
  }
  if (action === "models") {
    return listProviderModels(current, options);
  }

  if (action === "list")
    return {
      result: successResult("config", {
        scope: "user",
        config: defaultSecretRedactor.maskValue(current)
      }),
      exitCode: EXIT_CODES.SUCCESS
    };
  if (action === "get" && key) {
    try {
      return {
        result: successResult("config", {
          key,
          value: maskByContext(key, getPath(current, key))
        }),
        exitCode: EXIT_CODES.SUCCESS
      };
    } catch (error) {
      return invalidKey(error);
    }
  }
  if (action === "set" && key && value !== undefined) {
    if (isUnsplashConfigKey(key)) {
      return unsplashSetBlocked();
    }
    if (isPixabayConfigKey(key)) {
      return pixabaySetBlocked();
    }
    try {
      const next = setPath(
        structuredClone(current) as Record<string, unknown>,
        key,
        parseValue(value)
      );
      await writeUserConfig(next as never, userConfigPath);
      const baseDetails = {
        scope: "user" as const,
        key,
        value: maskByContext(key, getPath(next, key))
      };

      if (isApiKeyConfigKey(key)) {
        return runApiKeyConnectionTest(next as UserConfig, key, baseDetails, options);
      }

      return {
        result: successResult("config", baseDetails),
        exitCode: EXIT_CODES.SUCCESS
      };
    } catch (error) {
      return invalidKey(error);
    }
  }
  return invalid();
}

async function listProviderModels(
  current: UserConfig,
  options: ConfigServiceOptions
): Promise<ServiceOutcome> {
  const resolved = resolveProviderTarget(current, options);
  if ("error" in resolved) return resolved.error;

  const { providerId, endpoint, apiKey } = resolved;
  const client = new ModelDiscoveryClient({
    providerId,
    endpoint,
    apiKey,
    redactor: defaultSecretRedactor,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {})
  });

  try {
    const listing = await client.listModels();
    if (!listing.supported) {
      return {
        result: successResult("config", {
          action: "models",
          provider: providerId,
          endpoint: defaultSecretRedactor.mask(endpoint),
          source: "unavailable",
          models: [],
          reason: listing.reason,
          fallback:
            "Enter a model id manually (for example via config setup) when discovery is unavailable."
        }),
        exitCode: EXIT_CODES.SUCCESS
      };
    }

    const models = annotateModelsWithVisionHints(providerId, listing.models);
    const warnings = models
      .filter((model) => model.vision !== true)
      .map((model) => describeVisionHint(model));

    return {
      result: successResult("config", {
        action: "models",
        provider: providerId,
        endpoint: defaultSecretRedactor.mask(endpoint),
        source: "discovery",
        models,
        warnings
      }),
      exitCode: EXIT_CODES.SUCCESS
    };
  } catch (error) {
    return providerFailure(error);
  }
}

async function runApiKeyConnectionTest(
  nextConfig: UserConfig,
  key: string,
  baseDetails: { scope: "user"; key: string; value: unknown },
  options: ConfigServiceOptions
): Promise<ServiceOutcome> {
  const providerFromKey = providerIdFromApiKeyPath(key);
  const providerOverride = options.provider ?? providerFromKey;
  const resolved = resolveProviderTarget(nextConfig, {
    ...(providerOverride !== undefined ? { provider: providerOverride } : {}),
    ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {})
  });
  if ("error" in resolved) {
    // Key already persisted; surface missing provider/key target as invalid_input.
    return resolved.error;
  }

  const { providerId, endpoint, apiKey } = resolved;
  const client = new ModelDiscoveryClient({
    providerId,
    endpoint,
    apiKey,
    redactor: defaultSecretRedactor,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {})
  });

  try {
    await client.testConnection();
    writeHumanConnectionOutcome(options.stderr, true, "Connection test succeeded.");
    return {
      result: successResult("config", {
        ...baseDetails,
        connectionTest: { ok: true }
      }),
      exitCode: EXIT_CODES.SUCCESS
    };
  } catch (error) {
    const failure = providerFailure(error);
    const reason = failure.result.reason ?? "provider_error";
    const message = failure.result.message ?? "Connection test failed.";
    writeHumanConnectionOutcome(options.stderr, false, message);
    return {
      result: errorResult("config", reason, message, {
        ...baseDetails,
        connectionTest: { ok: false, reason }
      }),
      exitCode: failure.exitCode
    };
  }
}

function writeHumanConnectionOutcome(
  stderr: NodeJS.WritableStream | undefined,
  ok: boolean,
  message: string
): void {
  if (stderr === undefined) return;
  const line = ok
    ? `smart-img config: connection test ok — ${message}\n`
    : `smart-img config: connection test failed — ${message}\n`;
  stderr.write(line);
}

function resolveProviderTarget(
  current: UserConfig,
  options: Pick<ConfigServiceOptions, "provider" | "endpoint">
): { providerId: VisionProviderId; endpoint: string; apiKey: string } | { error: ServiceOutcome } {
  const providerRaw = options.provider ?? current.activeProvider;
  if (!isVisionProviderId(providerRaw)) {
    return {
      error: {
        result: errorResult(
          "config",
          "invalid_input",
          `Unknown provider "${providerRaw}". Expected ollama, openrouter, or gemini.`
        ),
        exitCode: EXIT_CODES.INVALID_INPUT
      }
    };
  }

  const providerId = providerRaw;
  const preset = getVisionProviderPreset(providerId);
  const providerConfig = current.providers[providerId];
  const apiKey = providerConfig?.apiKey;
  if (apiKey === undefined || apiKey.length === 0) {
    return {
      error: {
        result: errorResult(
          "config",
          "invalid_input",
          `Missing API key for provider "${providerId}". Set providers.${providerId}.apiKey or run config setup.`
        ),
        exitCode: EXIT_CODES.INVALID_INPUT
      }
    };
  }

  const endpoint = (options.endpoint ?? providerConfig?.endpoint ?? preset.endpoint).replace(
    /\/+$/,
    ""
  );

  return { providerId, endpoint, apiKey };
}

function isVisionProviderId(value: string): value is VisionProviderId {
  return PROVIDER_IDS.has(value as VisionProviderId);
}

function isApiKeyConfigKey(dottedKey: string): boolean {
  const last = dottedKey.split(".").at(-1) ?? "";
  return API_KEY_SEGMENT.test(last);
}

/**
 * True when a dotted `config set` key targets the `unsplash` config subtree
 * (exactly `unsplash`, or any path under it such as `unsplash.accessKey`).
 * The Unsplash Access Key must be configured only through the private
 * interactive prompt (`smart-img config unsplash setup`); the generic
 * `config set` route is blocked for these keys so the key is never accepted
 * via process args, logged, or echoed back.
 */
function isUnsplashConfigKey(dottedKey: string): boolean {
  const first = dottedKey.split(".", 1)[0] ?? "";
  return first === "unsplash";
}

function unsplashSetBlocked(): ServiceOutcome {
  return {
    result: errorResult(
      "config",
      "invalid_input",
      "Unsplash Access Key must be configured through the private interactive prompt. Run `smart-img config unsplash setup` in a private terminal.",
      {
        reason: "missing_unsplash_credential",
        setupCommand:
          "Run `smart-img config unsplash setup` in a private interactive terminal and paste the key when prompted."
      }
    ),
    exitCode: EXIT_CODES.INVALID_INPUT
  };
}

function isPixabayConfigKey(dottedKey: string): boolean {
  return (dottedKey.split(".", 1)[0] ?? "") === "pixabay";
}

function pixabaySetBlocked(): ServiceOutcome {
  return {
    result: errorResult(
      "config",
      "invalid_input",
      "Pixabay API key must be configured through the private interactive prompt. Run `smart-img config pixabay setup` in a private terminal.",
      {
        reason: "missing_pixabay_credential",
        setupCommand:
          "Run `smart-img config pixabay setup` in a private interactive terminal and paste the key when prompted."
      }
    ),
    exitCode: EXIT_CODES.INVALID_INPUT
  };
}

function providerIdFromApiKeyPath(dottedKey: string): string | undefined {
  const parts = dottedKey.split(".");
  // providers.<id>.apiKey
  if (parts.length >= 3 && parts[0] === "providers" && isVisionProviderId(parts[1]!)) {
    return parts[1];
  }
  return undefined;
}

function providerFailure(error: unknown): ServiceOutcome {
  const reason =
    error instanceof AuthProviderError
      ? "provider_auth"
      : error instanceof ModelNotFoundProviderError
        ? "model_not_found"
        : error instanceof EndpointNotFoundProviderError
          ? "endpoint_not_found"
          : "provider_error";

  const message =
    error instanceof Error
      ? defaultSecretRedactor.mask(error.message)
      : defaultSecretRedactor.mask(String(error));

  const details: Record<string, unknown> = {};
  if (error instanceof VisionProviderError) {
    details.kind = error.kind;
    details.providerDetails = defaultSecretRedactor.maskValue(error.redactedDetails);
  }
  if (error instanceof ModelNotFoundProviderError) {
    details.model = error.model;
  }
  if (error instanceof EndpointNotFoundProviderError) {
    details.endpoint = defaultSecretRedactor.mask(error.endpoint);
  }

  return {
    result: errorResult(
      "config",
      reason,
      message,
      Object.keys(details).length > 0 ? details : undefined
    ),
    exitCode: EXIT_CODES.PROVIDER_ERROR
  };
}

function invalidKey(error: unknown): ServiceOutcome {
  if (error instanceof ConfigKeyError) {
    return {
      result: errorResult("config", "invalid_input", error.message),
      exitCode: EXIT_CODES.INVALID_INPUT
    };
  }
  // Project-config secret rejection and Zod schema validation produce plain
  // Error / ZodError instances during `set`. These are user-input validation
  // failures, not internal faults, so surface them as structured invalid_input
  // (exit 3) with the redacted message rather than crashing the process.
  if (error instanceof Error) {
    const msg = defaultSecretRedactor.mask(error.message);
    if (
      msg.includes("Project config must not contain") ||
      msg.includes("must not contain") ||
      isZodError(error)
    ) {
      return {
        result: errorResult("config", "invalid_input", msg),
        exitCode: EXIT_CODES.INVALID_INPUT
      };
    }
  }
  throw error;
}

function isZodError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name: string }).name === "ZodError"
  );
}

function invalid(): ServiceOutcome {
  return {
    result: errorResult(
      "config",
      "invalid_input",
      "Expected config list|get <key>|set <key> <value>|models|setup|pixabay setup"
    ),
    exitCode: EXIT_CODES.INVALID_INPUT
  };
}
function parseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function getPath(obj: unknown, dotted: string): unknown {
  assertSafeDottedKey(dotted);
  return dotted
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined,
      obj
    );
}
function setPath(
  obj: Record<string, unknown>,
  dotted: string,
  value: unknown
): Record<string, unknown> {
  assertSafeDottedKey(dotted);
  const parts = dotted.split(".");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    const next = cur[part];
    if (next === undefined || next === null || typeof next !== "object" || Array.isArray(next))
      cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts.at(-1)!] = value;
  return obj;
}

/**
 * Rejects dotted configuration keys that could enable prototype pollution or
 * traverse unsafe paths. Blocks `__proto__`, `constructor`, `prototype`,
 * empty segments (e.g. `a..b`, `.x`, `x.`), and segments that are not plain
 * property names.
 */
const FORBIDDEN_PROTO_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function assertSafeDottedKey(dotted: string): void {
  if (dotted.length === 0) {
    throw new ConfigKeyError("Configuration key must not be empty");
  }
  const parts = dotted.split(".");
  for (const part of parts) {
    if (part.length === 0) {
      throw new ConfigKeyError(`Configuration key has an empty segment: ${dotted}`);
    }
    if (FORBIDDEN_PROTO_SEGMENTS.has(part)) {
      throw new ConfigKeyError(`Configuration key uses a forbidden segment: ${part}`);
    }
  }
}

export class ConfigKeyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigKeyError";
  }
}
