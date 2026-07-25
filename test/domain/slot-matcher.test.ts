import { describe, expect, it } from "vitest";
import {
  explainCandidate,
  matchSlot,
  type SlotCandidate,
  type SlotRequest
} from "../../src/domain/slot-matcher.js";

const baseCandidate = (over: Partial<SlotCandidate> = {}): SlotCandidate => ({
  sha256: "sha",
  canonicalRelPath: "r.jpg",
  categories: ["kitchen"],
  orientation: "landscape",
  dims: { width: 2000, height: 1000 },
  ...over
});

const baseRequest = (over: Partial<SlotRequest> = {}): SlotRequest => ({
  category: "kitchen",
  orientation: "landscape",
  width: 1800,
  height: 900,
  ...over
});

describe("slot-matcher lexicographic scoring", () => {
  it("ranks a perfect-size same-category candidate first when all match", () => {
    const result = matchSlot([baseCandidate()], baseRequest());
    expect(result.ok).toBe(true);
  });

  it("ranks same-category undersized ahead of wrong-category perfect-size", () => {
    const undersized = baseCandidate({
      sha256: "under",
      dims: { width: 1000, height: 500 } // smaller than requested, same category
    });
    const wrongCategoryPerfect = baseCandidate({
      sha256: "wrong",
      categories: ["bathroom"], // wrong category, perfect size
      dims: { width: 2000, height: 1000 }
    });

    // Neither is a perfect match, so the result is ok:false with alternatives
    // ordered by lexicographic score. Same-category undersized must rank first.
    const result = matchSlot([undersized, wrongCategoryPerfect], baseRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.alternatives[0]!.candidate.sha256).toBe("under");
    }
  });

  it("ranks same-category wrong-orientation ahead of wrong-category correct-orientation", () => {
    const sameCatWrongOrient = baseCandidate({
      sha256: "same-or",
      orientation: "portrait" // wrong orientation, same category, perfect size
    });
    const wrongCatRightOrient = baseCandidate({
      sha256: "wrong-or",
      categories: ["bathroom"], // wrong category, correct orientation, perfect size
      orientation: "landscape"
    });

    const result = matchSlot([sameCatWrongOrient, wrongCatRightOrient], baseRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.alternatives[0]!.candidate.sha256).toBe("same-or");
    }
  });

  it("category mismatch score exceeds any orientation-only mismatch score", () => {
    const wrongCat = explainCandidate(
      baseCandidate({ sha256: "wc", categories: ["bathroom"] }),
      baseRequest()
    );
    const wrongOrient = explainCandidate(
      baseCandidate({ sha256: "wo", orientation: "portrait" }),
      baseRequest()
    );
    expect(wrongCat.score).toBeGreaterThan(wrongOrient.score);
  });

  it("orientation mismatch score exceeds any dimension-deficit-only mismatch score", () => {
    const wrongOrient = explainCandidate(
      baseCandidate({ sha256: "wo", orientation: "portrait" }),
      baseRequest()
    );
    const hugeDeficit = explainCandidate(
      baseCandidate({ sha256: "hd", dims: { width: 1, height: 1 } }),
      baseRequest()
    );
    expect(wrongOrient.score).toBeGreaterThan(hugeDeficit.score);
  });

  // --- Extreme-dimension guard: lower-priority values must never overtake a
  // higher-priority category, no matter how large the pixel deficit/surplus.
  it("extreme dimension deficit cannot overtake orientation mismatch", () => {
    // Width/height at the integer max safe range so the deficit is astronomically
    // larger than any band base — a scalar-weight scheme would let this leak.
    const extremeRequest = baseRequest({
      width: Number.MAX_SAFE_INTEGER,
      height: Number.MAX_SAFE_INTEGER
    });
    const wrongOrientation = explainCandidate(
      baseCandidate({ sha256: "wo", orientation: "portrait" }),
      extremeRequest
    );
    const hugeDeficit = explainCandidate(
      baseCandidate({ sha256: "hd", dims: { width: 1, height: 1 } }),
      extremeRequest
    );
    // Orientation is a higher-priority band than dimension deficit, so the
    // wrong-orientation candidate must still score strictly higher (worse) than
    // the dimension-deficit-only candidate.
    expect(wrongOrientation.score).toBeGreaterThan(hugeDeficit.score);
  });

  it("extreme dimension deficit cannot overtake category mismatch", () => {
    const extremeRequest = baseRequest({
      width: Number.MAX_SAFE_INTEGER,
      height: Number.MAX_SAFE_INTEGER,
      category: "outdoor"
    });
    const wrongCategory = explainCandidate(
      baseCandidate({ sha256: "wc", categories: ["kitchen"] }),
      extremeRequest
    );
    const hugeDeficitSameCat = explainCandidate(
      baseCandidate({ sha256: "hd", categories: ["outdoor"], dims: { width: 1, height: 1 } }),
      extremeRequest
    );
    // Category is the highest-priority band: even the worst dimension deficit on
    // a matching category must rank BETTER (lower score) than a category mismatch.
    expect(wrongCategory.score).toBeGreaterThan(hugeDeficitSameCat.score);
  });

  it("extreme dimension surplus cannot overtake orientation mismatch", () => {
    // Surplus is added into the dimension sub-score; cap must still contain it.
    const extremeRequest = baseRequest({ width: 1, height: 1 });
    const wrongOrientation = explainCandidate(
      baseCandidate({ sha256: "wo", orientation: "portrait" }),
      extremeRequest
    );
    const hugeSurplus = explainCandidate(
      baseCandidate({
        sha256: "hs",
        dims: { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER }
      }),
      extremeRequest
    );
    expect(wrongOrientation.score).toBeGreaterThan(hugeSurplus.score);
  });

  it("breaks ties deterministically by smaller dimension deficit", () => {
    const closer = baseCandidate({ sha256: "closer", dims: { width: 1790, height: 900 } });
    const farther = baseCandidate({ sha256: "farther", dims: { width: 1000, height: 500 } });
    const closerScore = explainCandidate(closer, baseRequest()).score;
    const fartherScore = explainCandidate(farther, baseRequest()).score;
    expect(closerScore).toBeLessThan(fartherScore);
  });

  it("returns alternatives sorted by score and limited to top 3", () => {
    const candidates = [
      baseCandidate({ sha256: "a", categories: ["bathroom"] }),
      baseCandidate({ sha256: "b", orientation: "portrait" }),
      baseCandidate({ sha256: "c", dims: { width: 100, height: 100 } }),
      baseCandidate({ sha256: "d", orientation: "square" })
    ];
    const result = matchSlot(candidates, baseRequest());
    // No perfect match -> ok:false
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.alternatives).toHaveLength(3);
      for (let i = 1; i < result.alternatives.length; i += 1) {
        expect(result.alternatives[i]!.score).toBeGreaterThanOrEqual(
          result.alternatives[i - 1]!.score
        );
      }
    }
  });

  it("prefers a non-reused candidate over a reused one for the same slot+location", () => {
    const reused = baseCandidate({
      sha256: "reused",
      used: [{ slot: "home.hero", location: "slider-1" }]
    });
    const fresh = baseCandidate({ sha256: "fresh" });
    const request = baseRequest({ slot: "home.hero", location: "slider-1" });

    // Both satisfy every hard constraint, so both are eligible. The fresh one
    // has no reuse penalty and must rank first.
    const result = matchSlot([reused, fresh], request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidate.sha256).toBe("fresh");
    }
  });

  it("ranks a reused hard-constraint-satisfying candidate above a same-category dimension-deficit candidate", () => {
    // Protects the T1 (reuse) < T2 (dimension deficit) invariant: a reused
    // candidate that still satisfies every hard constraint must rank better
    // than a same-category candidate that violates dimensions.
    const reused = baseCandidate({
      sha256: "reused",
      dims: { width: 2000, height: 1000 }, // satisfies requested 1800x900
      used: [{ slot: "home.hero", location: "slider-1" }]
    });
    const dimensionDeficit = baseCandidate({
      sha256: "deficit",
      dims: { width: 1000, height: 500 }, // same category, but undersized
      used: [] // not reused -> only the dimension deficit applies
    });
    const request = baseRequest({ slot: "home.hero", location: "slider-1" });

    const result = matchSlot([reused, dimensionDeficit], request);
    // Neither is a perfect match (reuse and deficit both produce reasons), so
    // the result is ok:false with alternatives ordered by lexicographic score.
    // The reused candidate sits in T1, the deficit candidate in T2, so reuse
    // must rank first.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.alternatives[0]!.candidate.sha256).toBe("reused");
    }

    // Direct score assertion: reuse tier (T1) strictly below deficit tier (T2).
    // Band bases mirror src/domain/slot-matcher.ts (constants are not exported,
    // so we assert against local numeric band constants).
    const T1_BASE = 1_000_000_000; // reuse penalty band starts
    const T2_BASE = 2_000_000_000; // dimension deficit band starts
    const T3_BASE = 3_000_000_000; // orientation mismatch band starts
    const reusedScore = explainCandidate(reused, request).score;
    const deficitScore = explainCandidate(dimensionDeficit, request).score;
    expect(reusedScore).toBeLessThan(deficitScore);
    // Reused candidate sits in T1: [T1_BASE, T2_BASE)
    expect(reusedScore).toBeGreaterThanOrEqual(T1_BASE);
    expect(reusedScore).toBeLessThan(T2_BASE);
    // Deficit candidate sits in T2: [T2_BASE, T3_BASE)
    expect(deficitScore).toBeGreaterThanOrEqual(T2_BASE);
    expect(deficitScore).toBeLessThan(T3_BASE);
  });

  it("keeps a reused image eligible when --allow-reuse is passed", () => {
    const reused = baseCandidate({
      sha256: "reused",
      used: [{ slot: "home.hero", location: "slider-1" }]
    });
    const request = baseRequest({
      slot: "home.hero",
      location: "slider-1",
      allowReuse: true
    });

    const result = matchSlot([reused], request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidate.sha256).toBe("reused");
    }
  });

  it("excludes orientation mismatches from eligible semantic ranking candidates", () => {
    const wrongOrientation = baseCandidate({
      sha256: "wrong-orientation",
      orientation: "portrait"
    });
    const eligible = baseCandidate({ sha256: "eligible" });

    const result = matchSlot([wrongOrientation, eligible], baseRequest());

    expect(result.ok).toBe(true);
    expect(result.eligible.map((alternative) => alternative.candidate.sha256)).toEqual([
      "eligible"
    ]);
  });

  it("excludes dimension deficits from eligible semantic ranking candidates", () => {
    const undersized = baseCandidate({ sha256: "undersized", dims: { width: 1000, height: 500 } });
    const eligible = baseCandidate({ sha256: "eligible" });

    const result = matchSlot([undersized, eligible], baseRequest());

    expect(result.ok).toBe(true);
    expect(result.eligible.map((alternative) => alternative.candidate.sha256)).toEqual([
      "eligible"
    ]);
  });

  it("excludes used candidates from eligible unless reuse is allowed", () => {
    const reused = baseCandidate({
      sha256: "reused",
      used: [{ slot: "home.hero", location: "slider-1" }]
    });
    const fresh = baseCandidate({ sha256: "fresh" });
    const request = baseRequest({ slot: "home.hero", location: "slider-1" });

    const noReuseResult = matchSlot([reused, fresh], request);
    const allowReuseResult = matchSlot([reused, fresh], { ...request, allowReuse: true });

    expect(noReuseResult.eligible.map((alternative) => alternative.candidate.sha256)).toEqual([
      "fresh"
    ]);
    expect(allowReuseResult.eligible.map((alternative) => alternative.candidate.sha256)).toEqual([
      "reused",
      "fresh"
    ]);
  });
});
