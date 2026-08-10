import type { Orientation } from "./slot-matcher.js";

/** Inclusive square band: 0.9 ≤ w/h ≤ 1.1. */
export const SQUARE_MIN = 0.9;
export const SQUARE_MAX = 1.1;
/** Inclusive panorama band: w/h ≥ 2.0. */
export const PANORAMA_MIN = 2.0;

const WEBFORMAT_MAX_EDGE = 640;
const LARGE_MAX_EDGE = 1280;
const FULL_HD_MAX_EDGE = 1920;

export type Dims = { width: number; height: number };

/** Full API Access is discovered per response via `fullHDURL` / `imageURL` (D7). */
export type PixabayHit = {
  id: number;
  webformatURL: string;
  largeImageURL: string;
  fullHDURL?: string;
  imageURL?: string;
  imageWidth: number;
  imageHeight: number;
};

export type ResolutionCapWarning = {
  code: "resolution_cap";
  requested: Dims;
  delivered: Dims;
  maxRenditionEdge: number;
  cause: "full_api_access_unavailable";
};

export type RenditionChoice =
  | { ok: true; url: string; dims: Dims; warning?: ResolutionCapWarning }
  | { ok: false; reason: "source_too_small" };

type Rung = { url: string; dims: Dims; maxEdge: number };

/**
 * Partition ratios into Orientation bands (D2):
 * portrait < 0.9 ≤ square ≤ 1.1 < landscape < 2.0 ≤ panorama.
 */
export function aspectBand(width: number, height: number): Orientation {
  assertPositiveDimensions(width, height);
  const ratio = width / height;
  if (ratio < SQUARE_MIN) return "portrait";
  if (ratio <= SQUARE_MAX) return "square";
  if (ratio < PANORAMA_MIN) return "landscape";
  return "panorama";
}

/**
 * Map a band to the Pixabay API `orientation` pre-filter (D3).
 * `square` has no API equivalent — filter locally after the response.
 */
export function orientationParam(band: Orientation): "horizontal" | "vertical" | undefined {
  switch (band) {
    case "landscape":
    case "panorama":
      return "horizontal";
    case "portrait":
      return "vertical";
    case "square":
      return undefined;
  }
}

/**
 * Smallest available rung that satisfies the request without upscaling.
 * Ladder: webformat(640) → large(1280) → fullHD(1920) → imageURL(source).
 * Source < request → `source_too_small`; tier-capped → success + `resolution_cap`.
 */
export function selectRendition(hit: PixabayHit, req: Partial<Dims>): RenditionChoice {
  assertPositiveDimensions(hit.imageWidth, hit.imageHeight);
  assertRequestedDims(req);

  const source: Dims = { width: hit.imageWidth, height: hit.imageHeight };
  if (!satisfies(source, req)) {
    return { ok: false, reason: "source_too_small" };
  }

  const rungs = buildRungs(hit, source);
  const matching = rungs.find((rung) => satisfies(rung.dims, req));
  if (matching) {
    return { ok: true, url: matching.url, dims: matching.dims };
  }

  // Source fits, but the highest available rung is still short (no Full API Access).
  const best = rungs[rungs.length - 1];
  if (best === undefined) {
    return { ok: false, reason: "source_too_small" };
  }

  return {
    ok: true,
    url: best.url,
    dims: best.dims,
    warning: {
      code: "resolution_cap",
      requested: {
        width: req.width ?? best.dims.width,
        height: req.height ?? best.dims.height
      },
      delivered: best.dims,
      maxRenditionEdge: best.maxEdge,
      cause: "full_api_access_unavailable"
    }
  };
}

function buildRungs(hit: PixabayHit, source: Dims): Rung[] {
  const rungs: Rung[] = [
    rung(hit.webformatURL, source, WEBFORMAT_MAX_EDGE),
    rung(hit.largeImageURL, source, LARGE_MAX_EDGE)
  ];
  if (hit.fullHDURL) rungs.push(rung(hit.fullHDURL, source, FULL_HD_MAX_EDGE));
  if (hit.imageURL) {
    rungs.push({ url: hit.imageURL, dims: source, maxEdge: longEdge(source) });
  }
  return rungs;
}

function rung(url: string, source: Dims, nominalMax: number): Rung {
  return {
    url,
    dims: scaleToMaxEdge(source, nominalMax),
    maxEdge: Math.min(nominalMax, longEdge(source))
  };
}

/** Scale long edge to `maxEdge`; never enlarge past source. */
function scaleToMaxEdge(source: Dims, maxEdge: number): Dims {
  const long = longEdge(source);
  if (long <= maxEdge) return { width: source.width, height: source.height };
  const ratio = maxEdge / long;
  return {
    width: Math.max(1, Math.round(source.width * ratio)),
    height: Math.max(1, Math.round(source.height * ratio))
  };
}

function satisfies(dims: Dims, req: Partial<Dims>): boolean {
  if (req.width !== undefined && dims.width < req.width) return false;
  if (req.height !== undefined && dims.height < req.height) return false;
  return true;
}

function longEdge(dims: Dims): number {
  return Math.max(dims.width, dims.height);
}

function assertPositiveDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Image dimensions must be positive numbers");
  }
}

function assertRequestedDims(req: Partial<Dims>): void {
  for (const value of [req.width, req.height]) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new Error("Requested dimensions must be positive numbers");
    }
  }
}
