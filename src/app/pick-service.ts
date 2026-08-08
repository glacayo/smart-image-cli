import fs from "node:fs/promises";
import path from "node:path";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import { SqliteIndex } from "../adapters/sqlite-index.js";
import { SidecarStore } from "../adapters/sidecar-store.js";
import { SharpProcessor } from "../adapters/sharp-processor.js";
import { StorageRootGuard } from "../adapters/storage-root-guard.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import {
  UnsplashClient,
  UnsplashClientError,
  type UnsplashPhoto
} from "../adapters/unsplash-client.js";
import { LocalTextRanker } from "../adapters/vision/local-text-ranker.js";
import {
  VisionProviderError,
  type RankingEntry,
  type TextRankerProvider
} from "../adapters/vision/provider.js";
import { planResize, type ImageFormat } from "../domain/resize-planner.js";
import { matchSlot, type SlotAlternative, type SlotRequest } from "../domain/slot-matcher.js";
import { sanitizeSlug } from "../domain/slug-namer.js";
import {
  appendUsage,
  ensureIndexReady,
  stableNow,
  resolveUnsplashCredential,
  MissingUnsplashCredentialError,
  type ResolvedUnsplashCredential,
  type ServiceOutcome
} from "./runtime.js";

export type SemanticMode = "local" | "ai";
/** External sources stay explicit; Unsplash remains until removal slices (WU6*). */
export type PickSource = "local" | "unsplash" | "pixabay";

/** Pixabay search `q` hard limit (API + CLI contract). */
export const PIXABAY_MAX_QUERY_LENGTH = 100;

export type PickOptions = SlotRequest & {
  format?: ImageFormat;
  query?: string;
  semantic?: SemanticMode;
  topK?: number;
  source?: PickSource;
  /**
   * Pixabay safesearch flag. Defaults to `true` when `--source pixabay`.
   * Ignored for local/unsplash sources.
   */
  safeSearch?: boolean;
};

export type PickDeps = {
  /** Inject an alternate index (e.g. a failing/stub for tests). When omitted, a fresh `SqliteIndex(root)` is created and owned by the service. */
  index?: SqliteIndex;
  /** Inject a semantic text ranker. Required by command wiring for AI mode; local mode falls back to LocalTextRanker. */
  textRanker?: TextRankerProvider;
  /** Inject an Unsplash client for tests or alternate transports. */
  unsplashClient?: Pick<UnsplashClient, "searchPhotos" | "trackDownload" | "downloadPhoto">;
  /**
   * Inject the Unsplash credential resolver. Production resolves env override
   * > user config; tests inject a stub to avoid touching the real config or env.
   * Only consulted when `unsplashClient` is not injected.
   */
  resolveUnsplashCredential?: () => Promise<ResolvedUnsplashCredential>;
};

type RankingBlock = {
  status: "ranked";
  mode: SemanticMode;
  query: string;
  reason: string;
  score: number;
  topK: number;
  alternatives: Array<{ sha256: string; score: number; reason: string }>;
};

type NoCandidateRankingBlock = {
  status: "no_candidate";
  mode: SemanticMode;
  query: string;
  reason: "no_candidate";
  score: 0;
  alternatives: [];
};

const MAX_RANKING_QUERY_LENGTH = 160;

export async function pickService(
  rootInput: string,
  options: PickOptions,
  deps: PickDeps = {}
): Promise<ServiceOutcome> {
  const root = path.resolve(rootInput);
  if ((options.source ?? "local") === "unsplash") {
    return pickUnsplashService(root, options, deps);
  }
  // WU5a: never fall back to the local index for explicit pixabay.
  // Search/download/used-ids land in WU5b (`pickPixabayService`).
  if (options.source === "pixabay") {
    return pixabaySourceNotWiredYet();
  }
  const sidecars = new SidecarStore(root);
  const injectedIndex = deps.index;
  const index = injectedIndex ?? new SqliteIndex(root);
  const ownIndex = injectedIndex === undefined;
  try {
    await ensureIndexReady(index, sidecars);
    const records = index.query();
    const match = matchSlot(
      records.map((r) => ({
        sha256: r.sha256,
        canonicalRelPath: r.canonicalRelPath,
        categories: r.classification.categories,
        subject: r.classification.subject,
        title: r.classification.title,
        description: r.classification.description,
        altText: r.classification.altText,
        orientation: r.classification.orientation,
        dims: r.dims,
        used: r.used
      })),
      options,
      options.topK === undefined ? {} : { topK: options.topK }
    );
    const semantic = semanticMode(options);
    const topK = options.topK ?? 3;
    if (!match.ok)
      return {
        result: errorResult(
          "pick",
          "no_candidate",
          "No indexed image satisfies the requested slot constraints",
          {
            alternatives: match.alternatives,
            ...(semantic ? { ranking: noCandidateRanking(semantic) } : {})
          }
        ),
        exitCode: EXIT_CODES.NO_MATCH
      };

    let ranking: Awaited<ReturnType<typeof rankEligibleCandidates>> | undefined;
    try {
      ranking = semantic
        ? await rankEligibleCandidates(semantic, topK, match.eligible, deps.textRanker)
        : undefined;
    } catch (error) {
      if (error instanceof AiRankingFailedError) {
        return aiRankingFailed(error.cause);
      }
      throw error;
    }
    if (semantic && ranking === undefined) {
      return {
        result: errorResult(
          "pick",
          "no_candidate",
          "No ranked image candidate was returned for the semantic query",
          { alternatives: match.alternatives, ranking: noCandidateRanking(semantic) }
        ),
        exitCode: EXIT_CODES.NO_MATCH
      };
    }

    const selectedSha = ranking?.selected.sha256 ?? match.candidate.sha256;
    const candidate = records.find((r) => r.sha256 === selectedSha)!;
    const format = options.format ?? "jpg";
    const resizeTarget = {
      format,
      mode: options.width && options.height ? ("crop" as const) : ("resize" as const)
    };
    if (options.width !== undefined) Object.assign(resizeTarget, { width: options.width });
    if (options.height !== undefined) Object.assign(resizeTarget, { height: options.height });
    const plan = planResize(candidate.dims, resizeTarget);
    if (!plan.ok)
      return {
        result: errorResult(
          "pick",
          "no_candidate",
          "Candidate cannot satisfy request without upscaling",
          {
            cause: plan.reason,
            alternatives: match.alternatives,
            ...(ranking ? { ranking: ranking.block } : {})
          }
        ),
        exitCode: EXIT_CODES.NO_MATCH
      };
    const guard = new StorageRootGuard(root);
    // The index-derived canonicalRelPath is trusted storage, not user input, but
    // a corrupted/tampered sidecar could still point a symlink/junction escape
    // outside root. Validate the source through the guard (realpath + containment)
    // and reject missing/escaped sources with a typed safe error BEFORE produce.
    const source = path.join(root, candidate.canonicalRelPath);
    let validatedSource: string;
    try {
      validatedSource = await guard.ensureInside(source, true);
      const stat = await fs.stat(validatedSource);
      if (!stat.isFile()) {
        return {
          result: errorResult("pick", "no_candidate", "Indexed candidate is not a readable file", {
            canonicalRelPath: candidate.canonicalRelPath
          }),
          exitCode: EXIT_CODES.NO_MATCH
        };
      }
    } catch (error) {
      return {
        result: errorResult(
          "pick",
          "no_candidate",
          "Indexed candidate source failed root-guard validation",
          {
            canonicalRelPath: candidate.canonicalRelPath,
            error:
              error instanceof Error
                ? defaultSecretRedactor.mask(error.message)
                : defaultSecretRedactor.mask(String(error))
          }
        ),
        exitCode: EXIT_CODES.NO_MATCH
      };
    }
    const output = await uniquePickOutput(root, options, candidate.sha256, format);
    const processor = new SharpProcessor(guard);
    const asset = await processor.produce(validatedSource, output, plan);
    const usage = {
      sha256: candidate.sha256,
      slot: options.slot ?? "default",
      location: options.location ?? asset.path,
      source: "pick" as const,
      at: stableNow()
    };
    try {
      await appendUsage(root, index, usage);
    } catch (usageError) {
      // The produced _out asset is not safely usable without a durable usage
      // record. Roll back the produced output and return a structured
      // `usage_failed` result so callers get an actionable reason instead of a
      // generic filesystem_error. appendUsage truncates the journal line when
      // the SQLite index update fails AFTER the journal is durably written, so
      // no durable usage marking survives a rolled-back pick.
      await fs.rm(asset.path, { force: true }).catch(() => undefined);
      return {
        result: errorResult(
          "pick",
          "usage_failed",
          "Produced output was rolled back because durable usage recording failed",
          {
            sha256: candidate.sha256,
            output: path.relative(root, asset.path).split(path.sep).join("/"),
            error: defaultSecretRedactor.mask(
              usageError instanceof Error ? usageError.message : String(usageError)
            )
          }
        ),
        exitCode: EXIT_CODES.FILESYSTEM_ERROR
      };
    }
    return {
      result: successResult("pick", {
        manifest: {
          sha256: candidate.sha256,
          source: candidate.canonicalRelPath,
          output: path.relative(root, asset.path).split(path.sep).join("/"),
          width: asset.width,
          height: asset.height,
          format: asset.format,
          usage,
          ...(ranking ? { ranking: ranking.block } : {})
        }
      }),
      exitCode: EXIT_CODES.SUCCESS
    };
  } finally {
    if (ownIndex) index.close();
  }
}

async function pickUnsplashService(
  root: string,
  options: PickOptions,
  deps: PickDeps
): Promise<ServiceOutcome> {
  const query = options.query?.trim();
  if (!query) {
    return {
      result: errorResult("pick", "invalid_input", "--source unsplash requires --query"),
      exitCode: EXIT_CODES.INVALID_INPUT
    };
  }
  if (options.orientation === "panorama") {
    return {
      result: errorResult(
        "pick",
        "invalid_input",
        "--source unsplash does not support --orientation panorama"
      ),
      exitCode: EXIT_CODES.INVALID_INPUT
    };
  }

  const format = options.format ?? "jpg";
  let photo: UnsplashPhoto | undefined;
  try {
    let client: Pick<UnsplashClient, "searchPhotos" | "trackDownload" | "downloadPhoto">;
    if (deps.unsplashClient !== undefined) {
      client = deps.unsplashClient;
    } else {
      const resolve = deps.resolveUnsplashCredential ?? resolveUnsplashCredential;
      let credential: ResolvedUnsplashCredential;
      try {
        credential = await resolve();
      } catch (error) {
        if (error instanceof MissingUnsplashCredentialError) {
          return missingUnsplashCredentialOutcome();
        }
        throw error;
      }
      client = new UnsplashClient({ accessKey: credential.accessKey });
    }
    const orientation = toUnsplashOrientation(options.orientation);
    const photos = await client.searchPhotos({
      query: unsplashQuery(options, query),
      ...(orientation !== undefined ? { orientation } : {}),
      perPage: Math.max(options.topK ?? 10, 10)
    });
    const eligible = photos.filter((candidate) => satisfiesRequestedSize(candidate, options));
    const usedSha = await usedShaForSlot(root, options);
    let bytes: Buffer | undefined;
    let sourceSha: string | undefined;
    for (const candidate of eligible) {
      const candidateBytes = await client.downloadPhoto(candidate);
      const candidateSha = await sha256Bytes(candidateBytes);
      if (!usedSha.has(candidateSha)) {
        photo = candidate;
        bytes = candidateBytes;
        sourceSha = candidateSha;
        break;
      }
    }
    if (photo === undefined || bytes === undefined || sourceSha === undefined) {
      return {
        result: errorResult(
          "pick",
          "no_candidate",
          "No Unsplash image satisfies the requested slot constraints",
          { source: "unsplash", query: safeRankingQuery(query) }
        ),
        exitCode: EXIT_CODES.NO_MATCH
      };
    }
    await client.trackDownload(photo);
    const guard = new StorageRootGuard(root);
    const downloadPath = await writeUnsplashSource(root, guard, photo, bytes);
    const processor = new SharpProcessor(guard);
    const plan = planResize(
      { width: photo.width, height: photo.height },
      {
        format,
        mode: options.width && options.height ? "crop" : "resize",
        ...(options.width !== undefined ? { width: options.width } : {}),
        ...(options.height !== undefined ? { height: options.height } : {})
      }
    );
    if (!plan.ok) {
      return {
        result: errorResult(
          "pick",
          "no_candidate",
          "Unsplash image cannot satisfy request without upscaling",
          {
            source: "unsplash",
            photoId: photo.id,
            cause: plan.reason
          }
        ),
        exitCode: EXIT_CODES.NO_MATCH
      };
    }
    const output = await uniquePickOutput(root, options, sourceSha, format);
    const asset = await processor.produce(downloadPath, output, plan);
    const usage = {
      sha256: sourceSha,
      slot: options.slot ?? "default",
      location: options.location ?? asset.path,
      source: "pick" as const,
      at: stableNow()
    };
    const index = new SqliteIndex(root);
    try {
      await appendUsage(root, index, usage);
    } catch (usageError) {
      await fs.rm(asset.path, { force: true }).catch(() => undefined);
      return {
        result: errorResult(
          "pick",
          "usage_failed",
          "Produced Unsplash output was rolled back because durable usage recording failed",
          {
            source: "unsplash",
            photoId: photo.id,
            output: path.relative(root, asset.path).split(path.sep).join("/"),
            error: defaultSecretRedactor.mask(
              usageError instanceof Error ? usageError.message : String(usageError)
            )
          }
        ),
        exitCode: EXIT_CODES.FILESYSTEM_ERROR
      };
    } finally {
      index.close();
    }
    return {
      result: successResult("pick", {
        manifest: {
          source: "unsplash",
          sha256: sourceSha,
          photoId: photo.id,
          photoUrl: photo.links.html,
          imageUrl: photo.urls.full ?? photo.urls.regular ?? photo.urls.raw,
          output: path.relative(root, asset.path).split(path.sep).join("/"),
          width: asset.width,
          height: asset.height,
          format: asset.format,
          photographerName: photo.photographerName,
          photographerUsername: photo.photographerUsername,
          photographerUrl: photo.photographerUrl,
          attributionText: photo.attributionText,
          attributionHtml: photo.attributionHtml,
          usage
        }
      }),
      exitCode: EXIT_CODES.SUCCESS
    };
  } catch (error) {
    if (error instanceof UnsplashClientError) {
      return {
        result: errorResult("pick", "provider_error", defaultSecretRedactor.mask(error.message), {
          source: "unsplash",
          status: error.status
        }),
        exitCode: EXIT_CODES.PROVIDER_ERROR
      };
    }
    throw error;
  }
}

function missingUnsplashCredentialOutcome(): ServiceOutcome {
  const error = new MissingUnsplashCredentialError();
  const guidance = error.guidance;
  return {
    result: errorResult("pick", guidance.reason, error.message, guidance),
    exitCode: EXIT_CODES.PROVIDER_ERROR
  };
}

async function usedShaForSlot(root: string, options: PickOptions): Promise<Set<string>> {
  if (options.allowReuse === true || options.slot === undefined || options.location === undefined) {
    return new Set();
  }
  let raw: string;
  try {
    raw = await fs.readFile(path.join(root, ".img-ia", "usage.jsonl"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
  const used = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { sha256?: unknown; slot?: unknown; location?: unknown };
      if (
        typeof event.sha256 === "string" &&
        event.slot === options.slot &&
        event.location === options.location
      ) {
        used.add(event.sha256);
      }
    } catch {
      // Match journal replay behavior: ignore torn or malformed lines.
    }
  }
  return used;
}

function unsplashQuery(options: PickOptions, query: string): string {
  const categories = [options.category, ...(options.categories ?? [])].filter(Boolean);
  return [...new Set([query, ...categories])].join(" ");
}

/** Compose Pixabay `q` from query + category hints (deduped, first-seen order). */
export function composePixabayQuery(
  options: Pick<PickOptions, "category" | "categories">,
  query: string
): string {
  const categories = [options.category, ...(options.categories ?? [])].filter(
    (c): c is string => typeof c === "string" && c.length > 0
  );
  return [...new Set([query, ...categories])].join(" ");
}

/** Fail closed for explicit pixabay until WU5b wires search/download (no local fallback). */
function pixabaySourceNotWiredYet(): ServiceOutcome {
  return {
    result: errorResult(
      "pick",
      "invalid_input",
      "Pixabay pick is not yet available in this build",
      { source: "pixabay" }
    ),
    exitCode: EXIT_CODES.INVALID_INPUT
  };
}

function toUnsplashOrientation(
  orientation: PickOptions["orientation"]
): "landscape" | "portrait" | "squarish" | undefined {
  if (orientation === "landscape" || orientation === "portrait") return orientation;
  if (orientation === "square") return "squarish";
  return undefined;
}

function satisfiesRequestedSize(photo: UnsplashPhoto, options: PickOptions): boolean {
  return (
    (options.width === undefined || photo.width >= options.width) &&
    (options.height === undefined || photo.height >= options.height)
  );
}

async function writeUnsplashSource(
  root: string,
  guard: StorageRootGuard,
  photo: UnsplashPhoto,
  bytes: Buffer
): Promise<string> {
  const fileName = `${sanitizeSlug(photo.id)}.jpg`;
  const target = path.join(root, ".img-ia", "unsplash", fileName);
  await guard.ensureParentInside(target);
  await fs.writeFile(target, bytes, { mode: 0o600 });
  return target;
}

async function sha256Bytes(bytes: Buffer): Promise<string> {
  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function semanticMode(options: PickOptions): { mode: SemanticMode; query: string } | undefined {
  const query = options.query?.trim();
  if (!query) return undefined;
  return { mode: options.semantic ?? "local", query };
}

async function rankEligibleCandidates(
  semantic: { mode: SemanticMode; query: string },
  topK: number,
  eligible: readonly SlotAlternative[],
  injectedRanker: TextRankerProvider | undefined
): Promise<{ selected: RankingEntry; block: RankingBlock } | undefined> {
  const ranker = injectedRanker ?? (semantic.mode === "local" ? new LocalTextRanker() : undefined);
  if (ranker === undefined) {
    throw new AiRankingFailedError(new Error("AI semantic ranking requires a TextRankerProvider"));
  }
  const candidates = eligible.map(({ candidate }) => ({
    sha256: candidate.sha256,
    subject: candidate.subject ?? "",
    title: candidate.title ?? "",
    description: candidate.description ?? "",
    altText: candidate.altText ?? "",
    categories: candidate.categories
  }));
  if (candidates.length === 0) return undefined;

  let ranked: RankingEntry[];
  try {
    ranked = await ranker.rank(semantic.query, candidates);
  } catch (error) {
    if (semantic.mode === "ai" || error instanceof VisionProviderError) {
      throw new AiRankingFailedError(error);
    }
    throw error;
  }

  const eligibleSha = new Set(candidates.map((candidate) => candidate.sha256));
  const selected = ranked.find((entry) => eligibleSha.has(entry.sha256));
  if (selected === undefined) {
    if (semantic.mode === "ai") {
      throw new AiRankingFailedError(
        new VisionProviderError(
          "MalformedOutput",
          "AI semantic ranking returned no eligible candidate",
          {
            rankedCount: ranked.length
          }
        )
      );
    }
    return undefined;
  }

  return {
    selected,
    block: {
      status: "ranked",
      mode: semantic.mode,
      query: safeRankingQuery(semantic.query),
      reason: defaultSecretRedactor.mask(selected.reason),
      score: selected.score,
      topK,
      alternatives: ranked
        .filter((entry) => entry.sha256 !== selected.sha256 && eligibleSha.has(entry.sha256))
        .slice(0, topK)
        .map((entry) => ({
          sha256: entry.sha256,
          score: entry.score,
          reason: defaultSecretRedactor.mask(entry.reason)
        }))
    }
  };
}

function aiRankingFailed(error: unknown): ServiceOutcome {
  const details =
    error instanceof VisionProviderError
      ? {
          kind: error.kind,
          providerDetails: defaultSecretRedactor.maskValue(error.redactedDetails)
        }
      : undefined;
  return {
    result: errorResult(
      "pick",
      "ai_ranking_failed",
      error instanceof Error
        ? defaultSecretRedactor.mask(error.message)
        : defaultSecretRedactor.mask(String(error)),
      details
    ),
    exitCode: EXIT_CODES.PROVIDER_ERROR
  };
}

function noCandidateRanking(semantic: {
  mode: SemanticMode;
  query: string;
}): NoCandidateRankingBlock {
  return {
    status: "no_candidate",
    mode: semantic.mode,
    query: safeRankingQuery(semantic.query),
    reason: "no_candidate",
    score: 0,
    alternatives: []
  };
}

function safeRankingQuery(query: string): string {
  const masked = defaultSecretRedactor.mask(query);
  return masked.length <= MAX_RANKING_QUERY_LENGTH
    ? masked
    : `${masked.slice(0, MAX_RANKING_QUERY_LENGTH - 1)}…`;
}

export class AiRankingFailedError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "AiRankingFailedError";
  }
}

async function uniquePickOutput(
  root: string,
  options: PickOptions,
  sha256: string,
  format: ImageFormat
): Promise<string> {
  const base = sanitizeSlug(
    `${options.slot ?? "slot"}-${options.location ?? "asset"}-${sha256.slice(0, 8)}`
  );
  for (let i = 1; i < 10_000; i += 1) {
    const suffix = i === 1 ? "" : `-${i}`;
    const candidate = path.join(
      root,
      "_out",
      `${base}${suffix}.${format === "jpeg" ? "jpg" : format}`
    );
    try {
      await fs.stat(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error("Unable to allocate pick output path");
}
