import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import {
  PixabayClient,
  PixabayClientError,
  type PixabayRateLimit,
  type PixabaySearchHit,
  type PixabaySearchResult
} from "../adapters/pixabay-client.js";
import { canonicalKey, PixabayResponseCache } from "../adapters/pixabay-response-cache.js";
import { PixabayUsedIds } from "../adapters/pixabay-used-ids.js";
import { SharpProcessor } from "../adapters/sharp-processor.js";
import { SqliteIndex } from "../adapters/sqlite-index.js";
import { StorageRootGuard } from "../adapters/storage-root-guard.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import {
  aspectBand,
  orientationParam,
  selectRendition,
  type Dims,
  type ResolutionCapWarning
} from "../domain/pixabay-renditions.js";
import { planResize, type ImageFormat } from "../domain/resize-planner.js";
import { sanitizeSlug } from "../domain/slug-namer.js";
import type { Orientation, SlotRequest } from "../domain/slot-matcher.js";
import {
  appendUsage,
  MissingPixabayCredentialError,
  resolvePixabayApiKey,
  stableNow,
  toPosixRel,
  type ResolvedPixabayCredential,
  type ServiceOutcome
} from "./runtime.js";

const API = "https://pixabay.com/api/";
const DEFAULT_PER_PAGE = 20;
const EMPTY_SHAS: ReadonlySet<string> = new Set();

/** Candidate inputs (no download / output / CLI). safeSearch defaults true. */
export type PixabayCandidateRequest = {
  query: string;
  orientation?: Orientation;
  width?: number;
  height?: number;
  safeSearch?: boolean;
  perPage?: number;
};
export type PixabayCandidateDeps = {
  client: Pick<PixabayClient, "search">;
  cache: PixabayResponseCache;
  usedIds: Pick<PixabayUsedIds, "readMap">;
  /** Slot+location usage SHAs; exclude id only when mapped sha ∈ set (D4). */
  usedShas?: ReadonlySet<string>;
};
export type SelectedPixabayCandidate = {
  hit: PixabaySearchHit;
  url: string;
  dims: Dims;
  warning?: ResolutionCapWarning;
};
export type PixabayCandidateSuccess = {
  ok: true;
  candidate: SelectedPixabayCandidate;
  cache: "hit" | "miss" | "stale";
  candidatesFiltered: number;
  rateLimit?: PixabayRateLimit;
};
export type PixabayCandidateFailure = {
  ok: false;
  reason: "no_candidate" | "rate_limited" | "provider_error";
  message: string;
  cache?: "hit" | "miss" | "stale";
  candidatesFiltered?: number;
  kind?: PixabayClientError["kind"];
  status?: number;
  rateLimit?: PixabayRateLimit;
};
export type PixabayCandidateResult = PixabayCandidateSuccess | PixabayCandidateFailure;
export async function acquirePixabayCandidate(
  request: PixabayCandidateRequest,
  deps: PixabayCandidateDeps
): Promise<PixabayCandidateResult> {
  const query = request.query.trim();
  const safesearch = request.safeSearch ?? true;
  const perPage = Math.max(request.perPage ?? DEFAULT_PER_PAGE, DEFAULT_PER_PAGE);
  const apiOri =
    request.orientation !== undefined ? orientationParam(request.orientation) : undefined;
  const identity = buildPixabaySearchIdentity({
    query,
    safesearch,
    perPage,
    ...(apiOri !== undefined ? { orientation: apiOri } : {})
  });
  let cacheStatus: "hit" | "miss" | "stale" = "miss";
  try {
    const cached = await deps.cache.read<PixabaySearchResult>(identity);
    let search: PixabaySearchResult;
    if (cached.status === "hit" && isSearchPayload(cached.value)) {
      search = cached.value;
      cacheStatus = "hit";
    } else {
      cacheStatus = cached.status === "stale" ? "stale" : "miss";
      search = await deps.client.search({
        query,
        safesearch,
        perPage,
        ...(apiOri !== undefined ? { orientation: apiOri } : {})
      });
      await deps.cache.write(identity, search);
    }
    const idToSha = await deps.usedIds.readMap();
    const usedShas = deps.usedShas ?? EMPTY_SHAS;
    const req: Partial<Dims> = {
      ...(request.width !== undefined ? { width: request.width } : {}),
      ...(request.height !== undefined ? { height: request.height } : {})
    };
    const seen = new Set<number>();
    for (const hit of search.hits) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      if (
        request.orientation !== undefined &&
        aspectBand(hit.imageWidth, hit.imageHeight) !== request.orientation
      ) {
        continue;
      }
      const mapped = idToSha.get(hit.id);
      if (mapped !== undefined && usedShas.has(mapped)) continue;
      const choice = selectRendition(hit, req);
      if (!choice.ok) continue;
      return {
        ok: true,
        candidate: {
          hit,
          url: choice.url,
          dims: choice.dims,
          ...(choice.warning !== undefined ? { warning: choice.warning } : {})
        },
        cache: cacheStatus,
        candidatesFiltered: search.hits.length,
        ...(search.rateLimit !== undefined ? { rateLimit: search.rateLimit } : {})
      };
    }
    return {
      ok: false,
      reason: "no_candidate",
      message: "No Pixabay image satisfies the requested slot constraints",
      cache: cacheStatus,
      candidatesFiltered: search.hits.length
    };
  } catch (error) {
    if (!(error instanceof PixabayClientError)) throw error;
    return {
      ok: false,
      reason: error.kind === "rate_limited" ? "rate_limited" : "provider_error",
      message: defaultSecretRedactor.mask(error.message),
      cache: cacheStatus,
      kind: error.kind,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.rateLimit !== undefined ? { rateLimit: error.rateLimit } : {})
    };
  }
}

/** Key-free cache identity; always includes forced `image_type=photo`. */
export function buildPixabaySearchIdentity(options: {
  query: string;
  safesearch: boolean;
  perPage: number;
  orientation?: "horizontal" | "vertical";
}): string {
  const url = new URL(API);
  url.searchParams.set("q", options.query);
  url.searchParams.set("image_type", "photo");
  url.searchParams.set("safesearch", String(options.safesearch));
  url.searchParams.set("per_page", String(options.perPage));
  if (options.orientation !== undefined) url.searchParams.set("orientation", options.orientation);
  return canonicalKey(url);
}

function isSearchPayload(value: unknown): value is PixabaySearchResult {
  return (
    typeof value === "object" && value !== null && Array.isArray((value as { hits?: unknown }).hits)
  );
}

// --- WU5b3: download / Sharp / usage / used-id / pickService wiring ---
export type PixabayPickOptions = SlotRequest & {
  format?: ImageFormat;
  query?: string;
  topK?: number;
  safeSearch?: boolean;
};
export type PixabayPickDeps = {
  index?: SqliteIndex;
  pixabayClient?: Pick<PixabayClient, "search" | "download">;
  resolvePixabayCredential?: () => Promise<ResolvedPixabayCredential>;
  /** Test seam for used-id index; production uses `PixabayUsedIds`. */
  usedIds?: Pick<PixabayUsedIds, "readMap" | "append">;
};
const NO_CAND = "No Pixabay image satisfies the requested slot constraints";
const LICENSE = "Pixabay Content License";
const DISCLAIMER =
  "For combined-work use on the customer website only. Standalone redistribution of the original image is prohibited. Third-party rights may apply.";
const fail = (r: string, m: string, c: number, d?: Record<string, unknown>): ServiceOutcome => ({
  result: errorResult("pick", r, m, d),
  exitCode: c
});
const mask = (e: unknown) => defaultSecretRedactor.mask(e instanceof Error ? e.message : String(e));
const rm = async (p?: string) => {
  if (p) await fs.rm(p, { force: true }).catch(() => undefined);
};
const clientFail = (e: PixabayClientError) =>
  fail(
    e.kind === "rate_limited" ? "rate_limited" : "provider_error",
    mask(e),
    EXIT_CODES.PROVIDER_ERROR,
    {
      source: "pixabay",
      kind: e.kind,
      ...(e.status !== undefined ? { status: e.status } : {}),
      ...(e.rateLimit !== undefined ? { rateLimit: e.rateLimit } : {})
    }
  );
/** credential → candidate → one download → Sharp → usage → used-id (after usage). */
export async function pickPixabayService(
  root: string,
  options: PixabayPickOptions,
  deps: PixabayPickDeps = {}
): Promise<ServiceOutcome> {
  const query = options.query?.trim();
  if (!query)
    return fail("invalid_input", "--source pixabay requires --query", EXIT_CODES.INVALID_INPUT);
  const format: ImageFormat = options.format ?? "jpg";
  try {
    const client =
      deps.pixabayClient ??
      new PixabayClient({
        apiKey: (await (deps.resolvePixabayCredential ?? resolvePixabayApiKey)()).apiKey
      });
    const usedIds = deps.usedIds ?? new PixabayUsedIds({ root });
    const usedShas = await usedShaForSlot(root, options);
    const acquired = await acquirePixabayCandidate(
      {
        query,
        safeSearch: options.safeSearch ?? true,
        perPage: Math.max(options.topK ?? DEFAULT_PER_PAGE, DEFAULT_PER_PAGE),
        ...(options.orientation !== undefined ? { orientation: options.orientation } : {}),
        ...(options.width !== undefined ? { width: options.width } : {}),
        ...(options.height !== undefined ? { height: options.height } : {})
      },
      { client, cache: new PixabayResponseCache({ root }), usedIds, usedShas }
    );
    if (!acquired.ok) {
      const exit =
        acquired.reason === "no_candidate" ? EXIT_CODES.NO_MATCH : EXIT_CODES.PROVIDER_ERROR;
      return fail(acquired.reason, acquired.message, exit, {
        source: "pixabay",
        ...(acquired.cache !== undefined ? { cache: acquired.cache } : {}),
        ...(acquired.candidatesFiltered !== undefined
          ? { candidatesFiltered: acquired.candidatesFiltered }
          : {}),
        ...(acquired.kind !== undefined ? { kind: acquired.kind } : {}),
        ...(acquired.status !== undefined ? { status: acquired.status } : {}),
        ...(acquired.rateLimit !== undefined ? { rateLimit: acquired.rateLimit } : {})
      });
    }
    const { candidate, cache: cacheStatus, rateLimit, candidatesFiltered } = acquired;
    const { hit, url, dims, warning } = candidate;
    let srcPath: string | undefined;
    let outPath: string | undefined;
    try {
      const bytes = await client.download(url);
      const sourceSha = createHash("sha256").update(bytes).digest("hex");
      if (usedShas.has(sourceSha) && options.allowReuse !== true) {
        return fail("no_candidate", NO_CAND, EXIT_CODES.NO_MATCH, {
          source: "pixabay",
          cache: cacheStatus,
          candidatesFiltered
        });
      }
      const guard = new StorageRootGuard(root);
      srcPath = path.join(root, ".img-ia", "pixabay", `${hit.id}.jpg`);
      const tmp = `${srcPath}.${process.pid}.${Date.now()}.tmp`;
      await guard.ensureParentInside(srcPath);
      try {
        await fs.writeFile(tmp, bytes, { mode: 0o600 });
        await fs.rename(tmp, srcPath);
      } catch (e) {
        await rm(tmp);
        throw e;
      }
      const plan = planResize(dims, {
        format,
        mode: options.width && options.height ? "crop" : "resize",
        ...(options.width !== undefined ? { width: Math.min(options.width, dims.width) } : {}),
        ...(options.height !== undefined ? { height: Math.min(options.height, dims.height) } : {})
      });
      if (!plan.ok) {
        await rm(srcPath);
        return fail("no_candidate", NO_CAND, EXIT_CODES.NO_MATCH, {
          source: "pixabay",
          cache: cacheStatus,
          cause: plan.reason
        });
      }
      outPath = await uniqueOut(root, options, sourceSha, format);
      const asset = await new SharpProcessor(guard).produce(srcPath, outPath, plan);
      const usage = {
        sha256: sourceSha,
        slot: options.slot ?? "default",
        location: options.location ?? asset.path,
        source: "pick" as const,
        at: stableNow()
      };
      const injected = deps.index;
      const index = injected ?? new SqliteIndex(root);
      try {
        await appendUsage(root, index, usage);
      } catch (err) {
        await rm(asset.path);
        return fail(
          "usage_failed",
          "Produced Pixabay output was rolled back because durable usage recording failed",
          EXIT_CODES.FILESYSTEM_ERROR,
          {
            source: "pixabay",
            pixabayId: hit.id,
            output: toPosixRel(root, asset.path),
            error: mask(err)
          }
        );
      } finally {
        if (injected === undefined) index.close();
      }
      // Usage is truth; used-id index is secondary — never roll back output on index failure.
      const warnings: Array<Record<string, unknown>> = warning !== undefined ? [warning] : [];
      try {
        await usedIds.append(hit.id, sourceSha);
      } catch {
        warnings.push({ code: "used_id_index_degraded", cause: "append_failed" });
      }
      return {
        result: successResult("pick", {
          manifest: {
            source: "pixabay",
            sha256: sourceSha,
            pixabayId: hit.id,
            pageURL: hit.pageURL,
            contributor: hit.user,
            license: LICENSE,
            disclaimer: DISCLAIMER,
            imageUrl: url,
            output: toPosixRel(root, asset.path),
            width: asset.width,
            height: asset.height,
            format: asset.format,
            usage,
            cache: cacheStatus,
            ...(warnings.length > 0 ? { warnings } : {}),
            ...(rateLimit !== undefined ? { rateLimit } : {})
          }
        }),
        exitCode: EXIT_CODES.SUCCESS
      };
    } catch (error) {
      await rm(outPath);
      await rm(srcPath);
      if (error instanceof PixabayClientError) return clientFail(error);
      return fail("filesystem_error", mask(error), EXIT_CODES.FILESYSTEM_ERROR, {
        source: "pixabay",
        pixabayId: hit.id
      });
    }
  } catch (error) {
    if (error instanceof MissingPixabayCredentialError) {
      return fail(error.guidance.reason, error.message, EXIT_CODES.PROVIDER_ERROR, error.guidance);
    }
    if (error instanceof PixabayClientError) return clientFail(error);
    throw error;
  }
}

async function uniqueOut(
  root: string,
  o: PixabayPickOptions,
  sha: string,
  format: ImageFormat
): Promise<string> {
  const ext = format === "jpeg" ? "jpg" : format;
  const base = sanitizeSlug(`${o.slot ?? "slot"}-${o.location ?? "asset"}-${sha.slice(0, 8)}`);
  for (let i = 1; i < 10_000; i += 1) {
    const p = path.join(root, "_out", `${base}${i === 1 ? "" : `-${i}`}.${ext}`);
    try {
      await fs.stat(p);
    } catch {
      return p;
    }
  }
  throw new Error("Unable to allocate pick output path");
}
async function usedShaForSlot(root: string, o: PixabayPickOptions): Promise<Set<string>> {
  if (o.allowReuse === true || o.slot === undefined || o.location === undefined) return new Set();
  let raw: string;
  try {
    raw = await fs.readFile(path.join(root, ".img-ia", "usage.jsonl"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw e;
  }
  const used = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as { sha256?: unknown; slot?: unknown; location?: unknown };
      if (typeof ev.sha256 === "string" && ev.slot === o.slot && ev.location === o.location)
        used.add(ev.sha256);
    } catch {
      /* torn */
    }
  }
  return used;
}
