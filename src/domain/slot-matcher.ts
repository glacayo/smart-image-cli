export type Orientation = "landscape" | "portrait" | "square" | "panorama";

export type SlotCandidate = {
  sha256: string;
  canonicalRelPath: string;
  categories: readonly string[];
  orientation: Orientation;
  dims: { width: number; height: number };
  used?: readonly { slot: string; location: string }[];
};

export type SlotRequest = {
  category?: string;
  categories?: readonly string[];
  orientation?: Orientation;
  width?: number;
  height?: number;
  slot?: string;
  location?: string;
  allowReuse?: boolean;
};

export type SlotAlternative = {
  candidate: SlotCandidate;
  reasons: string[];
  score: number;
};

/**
 * Lexicographic (tier-selected) near-miss scoring. Per design.md, SlotMatcher
 * scores near-misses with a strict priority: category > orientation > dimension
 * deficit.
 *
 * The score encodes a STRICT lexicographic order. A candidate is placed in the
 * SINGLE HIGHEST-priority tier it violates — tiers are NOT summed. This is what
 * makes the order genuinely lexicographic and immune to magnitude overflow:
 * a single category mismatch is always worse than orientation+dimension+reuse
 * all wrong together, because the candidate is scored in the category tier
 * (T4), not as T3+T2+T1. A naive additive-weight scheme cannot guarantee this.
 *
 * Layout (ascending numeric score = worse fit):
 *
 *   tier 0  perfect match                    [0, T1_BASE)
 *   tier 1  reuse penalty (same slot+loc)    [T1_BASE, T2_BASE)
 *   tier 2  dimension deficit                [T2_BASE, T3_BASE)
 *   tier 3  orientation mismatch              [T3_BASE, T4_BASE)
 *   tier 4  category mismatch                [T4_BASE, +∞)
 *
 * Within a tier, a CAPPED dimension sub-score provides fine-grained ranking by
 * closeness to requested dimensions and smaller surplus. The cap
 * (MAX_DIMENSION_SUBSCORE - 1) is strictly smaller than the gap between
 * adjacent band bases, so the sub-score can never escape its tier.
 *
 * Reuse semantics: a reused candidate still satisfies every hard constraint
 * (category, orientation, dimensions) — reuse is a SOFT preference, so it
 * ranks above any candidate that VIOLATES a hard constraint. Reuse therefore
 * occupies the lowest non-perfect tier. It carries no magnitude of its own; the
 * dimension sub-score still sub-ranks reused candidates deterministically.
 */
const T1_BASE = 1_000_000_000; // reuse penalty band starts
const T2_BASE = 2_000_000_000; // dimension deficit band starts
const T3_BASE = 3_000_000_000; // orientation mismatch band starts
const T4_BASE = 4_000_000_000; // category mismatch band starts

// Capped sub-score for dimension deficit + surplus. Strictly smaller than the
// gap between adjacent band bases, so it can never escape its tier.
const MAX_DIMENSION_SUBSCORE = 1_000_000_000;

export type SlotMatchResult =
  | { ok: true; candidate: SlotCandidate; alternatives: SlotAlternative[] }
  | { ok: false; reason: "no_candidate"; alternatives: SlotAlternative[] };

export function matchSlot(
  candidates: readonly SlotCandidate[],
  request: SlotRequest
): SlotMatchResult {
  const alternatives = candidates.map((candidate) => explainCandidate(candidate, request));
  const eligible = alternatives
    .filter((alternative) => alternative.reasons.length === 0)
    .sort((a, b) => a.score - b.score);

  if (eligible[0]) {
    return {
      ok: true,
      candidate: eligible[0].candidate,
      alternatives: alternativesFor(alternatives)
    };
  }

  return { ok: false, reason: "no_candidate", alternatives: alternativesFor(alternatives) };
}

export function explainCandidate(candidate: SlotCandidate, request: SlotRequest): SlotAlternative {
  const reasons: string[] = [];
  const requestedCategories = requestedCategorySet(request);

  if (
    requestedCategories.length > 0 &&
    !candidate.categories.some((category) => requestedCategories.includes(category))
  ) {
    reasons.push("category_mismatch");
  }

  if (request.orientation !== undefined && candidate.orientation !== request.orientation) {
    reasons.push("orientation_mismatch");
  }

  if (request.width !== undefined && candidate.dims.width < request.width) {
    reasons.push("width_deficit");
  }

  if (request.height !== undefined && candidate.dims.height < request.height) {
    reasons.push("height_deficit");
  }

  if (isUsedForSameSlot(candidate, request)) {
    reasons.push("already_used_for_slot_location");
  }

  return { candidate, reasons, score: scoreCandidate(candidate, request, reasons) };
}

function requestedCategorySet(request: SlotRequest): string[] {
  return [
    ...new Set([...(request.category ? [request.category] : []), ...(request.categories ?? [])])
  ];
}

function isUsedForSameSlot(candidate: SlotCandidate, request: SlotRequest): boolean {
  if (request.allowReuse === true || request.slot === undefined || request.location === undefined) {
    return false;
  }

  return (
    candidate.used?.some(
      (used) => used.slot === request.slot && used.location === request.location
    ) ?? false
  );
}

/**
 * Lexicographic scoring by tier SELECTION (not summation). The candidate is
 * placed in the single highest-priority tier it violates; lower-priority
 * violations do NOT add to the score. This guarantees a single category
 * mismatch is always worse than any combination of lower-priority violations.
 *
 * Within the selected tier, a CAPPED dimension sub-score provides deterministic
 * fine-grained ranking by closeness to requested dimensions and smaller surplus.
 */
function scoreCandidate(
  candidate: SlotCandidate,
  request: SlotRequest,
  reasons: readonly string[]
): number {
  const has = (name: string): boolean => reasons.includes(name);

  // Select the highest-priority tier the candidate violates. Order matters:
  // category > orientation > dimension deficit > reuse. The first match wins
  // and determines the band; no lower tier is added on top.
  let tierBase: number;
  if (has("category_mismatch")) {
    tierBase = T4_BASE;
  } else if (has("orientation_mismatch")) {
    tierBase = T3_BASE;
  } else if (has("width_deficit") || has("height_deficit")) {
    tierBase = T2_BASE;
  } else if (has("already_used_for_slot_location")) {
    tierBase = T1_BASE;
  } else {
    tierBase = 0; // perfect match tier
  }

  // Capped dimension sub-score: deterministic within-tier ranking by closeness
  // to requested dimensions, lightly preferring smaller surplus. Capped so it
  // can never escape the selected tier's band.
  const widthDeficit = Math.max(0, (request.width ?? 0) - candidate.dims.width);
  const heightDeficit = Math.max(0, (request.height ?? 0) - candidate.dims.height);
  const deficit = widthDeficit + heightDeficit;
  const surplus =
    Math.max(0, candidate.dims.width - (request.width ?? 0)) +
    Math.max(0, candidate.dims.height - (request.height ?? 0));

  // Weight deficit 3x surplus: prefer closer to requested size; lightly prefer
  // smaller surplus as a stable deterministic tie-break.
  const rawSubScore = deficit * 3 + surplus;
  const cappedSubScore = Math.min(rawSubScore, MAX_DIMENSION_SUBSCORE - 1);

  return tierBase + cappedSubScore;
}

function alternativesFor(alternatives: readonly SlotAlternative[]): SlotAlternative[] {
  return [...alternatives].sort((a, b) => a.score - b.score).slice(0, 3);
}
