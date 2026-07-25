import { describe, expect, it } from "vitest";
import {
  localTextMatchedTokens,
  localTextMatchedTokensForTokens,
  localTextScore,
  localTextScoreForTokens,
  matchSlot,
  semanticTextTokens,
  type SlotCandidate
} from "../../src/domain/slot-matcher.js";

const baseCandidate = (over: Partial<SlotCandidate> = {}): SlotCandidate => ({
  sha256: "a".repeat(64),
  canonicalRelPath: "image.jpg",
  categories: ["bathroom"],
  orientation: "landscape",
  dims: { width: 1600, height: 900 },
  ...over
});

describe("slot matcher semantic text primitives", () => {
  it("tokenizes query text with stopword and punctuation removal", () => {
    expect(semanticTextTokens("The bright, naturally-lit shower and bath")).toEqual([
      "bright",
      "naturally",
      "lit",
      "shower",
      "bath"
    ]);
  });

  it("tokenizes unicode accents and numeric tokens deterministically", () => {
    expect(semanticTextTokens("Baños número 101: déjà vu — versión 2")).toEqual([
      "banos",
      "numero",
      "101",
      "deja",
      "vu",
      "version"
    ]);
  });

  it("pins local scoring weights by metadata field", () => {
    expect(localTextScore(baseCandidate({ subject: "shower" }), "shower")).toBe(3);
    expect(localTextScore(baseCandidate({ title: "shower" }), "shower")).toBe(2);
    expect(localTextScore(baseCandidate({ categories: ["shower"] }), "shower")).toBe(2);
    expect(localTextScore(baseCandidate({ altText: "shower" }), "shower")).toBe(1);
    expect(localTextScore(baseCandidate({ description: "shower" }), "shower")).toBe(1);
  });

  it("adds local scoring weights across fields", () => {
    const allFieldsMatch = baseCandidate({
      subject: "shower",
      title: "shower",
      categories: ["shower"],
      altText: "shower",
      description: "shower"
    });

    expect(localTextScore(allFieldsMatch, "shower")).toBe(9);
  });

  it("supports raw query and pre-tokenized local scoring APIs", () => {
    const candidate = baseCandidate({ subject: "Bright shower", categories: ["bathroom"] });
    const tokens = semanticTextTokens("bright bathroom shower");

    expect(localTextScore(candidate, "bright bathroom shower")).toBe(8);
    expect(localTextScoreForTokens(candidate, tokens)).toBe(8);
  });

  it("reports only query tokens that actually match local metadata", () => {
    const candidate = baseCandidate({ subject: "Bright shower", categories: ["bathroom"] });
    const tokens = semanticTextTokens("bright bathroom shower garden");

    expect(localTextMatchedTokens(candidate, "bright bathroom shower garden")).toEqual([
      "bright",
      "bathroom",
      "shower"
    ]);
    expect(localTextMatchedTokensForTokens(candidate, tokens)).toEqual([
      "bright",
      "bathroom",
      "shower"
    ]);
  });

  it("exposes only fully eligible candidates for semantic ranking", () => {
    const eligible = baseCandidate({ sha256: "b".repeat(64), subject: "plain bathroom" });
    const wrongCategory = baseCandidate({
      sha256: "c".repeat(64),
      categories: ["kitchen"],
      subject: "bright naturally lit shower"
    });

    const result = matchSlot([wrongCategory, eligible], { category: "bathroom" });

    expect(result.ok).toBe(true);
    expect(result.eligible.map((alternative) => alternative.candidate.sha256)).toEqual([
      eligible.sha256
    ]);
  });

  it("bounds alternatives with topK while preserving the default of 3", () => {
    const candidates = ["d", "e", "f", "0"].map((char) =>
      baseCandidate({ sha256: char.repeat(64), categories: ["kitchen"] })
    );

    const defaultResult = matchSlot(candidates, { category: "bathroom" });
    const topKResult = matchSlot(candidates, { category: "bathroom" }, { topK: 2 });

    expect(defaultResult.alternatives).toHaveLength(3);
    expect(topKResult.alternatives).toHaveLength(2);
  });

  it("keeps eligible unbounded while topK only caps alternatives", () => {
    const candidates = ["0", "1", "2", "3"].map((char) =>
      baseCandidate({ sha256: char.repeat(64) })
    );

    const result = matchSlot(candidates, { category: "bathroom" }, { topK: 2 });

    expect(result.ok).toBe(true);
    expect(result.eligible).toHaveLength(4);
    expect(result.alternatives).toHaveLength(2);
  });

  it("rejects invalid domain topK values", () => {
    const candidates = [baseCandidate()];

    expect(() => matchSlot(candidates, { category: "bathroom" }, { topK: 0 })).toThrow(RangeError);
    expect(() => matchSlot(candidates, { category: "bathroom" }, { topK: -1 })).toThrow(RangeError);
    expect(() => matchSlot(candidates, { category: "bathroom" }, { topK: 1.5 })).toThrow(
      RangeError
    );
  });
});
