import fs from "node:fs/promises";
import path from "node:path";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import { SqliteIndex } from "../adapters/sqlite-index.js";
import { SidecarStore } from "../adapters/sidecar-store.js";
import { SharpProcessor } from "../adapters/sharp-processor.js";
import { StorageRootGuard } from "../adapters/storage-root-guard.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import { LocalTextRanker } from "../adapters/vision/local-text-ranker.js";
import {
  VisionProviderError,
  type RankingEntry,
  type TextRankerProvider
} from "../adapters/vision/provider.js";
import { planResize, type ImageFormat } from "../domain/resize-planner.js";
import { matchSlot, type SlotAlternative, type SlotRequest } from "../domain/slot-matcher.js";
import { sanitizeSlug } from "../domain/slug-namer.js";
import { appendUsage, ensureIndexReady, stableNow, type ServiceOutcome } from "./runtime.js";
import { pickPixabayService, type PixabayPickDeps } from "./pixabay-pick-service.js";

export type SemanticMode = "local" | "ai";
/** External source is explicit pixabay; local is the default index path. */
export type PickSource = "local" | "pixabay";

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
   * Ignored for local source.
   */
  safeSearch?: boolean;
};

export type PickDeps = {
  /** Inject an alternate index (e.g. a failing/stub for tests). When omitted, a fresh `SqliteIndex(root)` is created and owned by the service. */
  index?: SqliteIndex;
  /** Inject a semantic text ranker. Required by command wiring for AI mode; local mode falls back to LocalTextRanker. */
  textRanker?: TextRankerProvider;
} & Pick<PixabayPickDeps, "pixabayClient" | "resolvePixabayCredential" | "usedIds">;

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
  if (options.source === "pixabay") return pickPixabayService(root, options, deps);
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
