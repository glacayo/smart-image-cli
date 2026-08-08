import {
  PixabayClientError,
  type PixabayClient,
  type PixabayRateLimit,
  type PixabaySearchHit,
  type PixabaySearchResult
} from "../adapters/pixabay-client.js";
import { canonicalKey, type PixabayResponseCache } from "../adapters/pixabay-response-cache.js";
import type { PixabayUsedIds } from "../adapters/pixabay-used-ids.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import {
  aspectBand,
  orientationParam,
  selectRendition,
  type Dims,
  type ResolutionCapWarning
} from "../domain/pixabay-renditions.js";
import type { Orientation } from "../domain/slot-matcher.js";

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
