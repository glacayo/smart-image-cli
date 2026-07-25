import { describe, expect, it } from "vitest";
import { LocalTextRanker } from "../../src/adapters/vision/local-text-ranker.js";
import type { RankingCandidateMeta } from "../../src/adapters/vision/provider.js";

const candidate = (over: Partial<RankingCandidateMeta>): RankingCandidateMeta => ({
  sha256: "a".repeat(64),
  subject: "",
  title: "",
  description: "",
  altText: "",
  categories: [],
  ...over
});

describe("LocalTextRanker", () => {
  it("orders candidates by deterministic weighted token overlap", async () => {
    const ranker = new LocalTextRanker();
    const result = await ranker.rank("bright bathroom shower", [
      candidate({
        sha256: "c".repeat(64),
        description: "bright shower"
      }),
      candidate({
        sha256: "b".repeat(64),
        subject: "bright bathroom shower"
      }),
      candidate({
        sha256: "d".repeat(64),
        categories: ["bathroom"]
      })
    ]);

    expect(result.map((entry) => entry.sha256)).toEqual([
      "b".repeat(64),
      "c".repeat(64),
      "d".repeat(64)
    ]);
    expect(result[0]!.reason).toContain("matched local metadata tokens");
  });

  it("reports matched metadata tokens per candidate instead of the full query", async () => {
    const ranker = new LocalTextRanker();
    const result = await ranker.rank("bright bathroom shower garden", [
      candidate({
        sha256: "a".repeat(64),
        title: "bright shower"
      }),
      candidate({
        sha256: "b".repeat(64),
        categories: ["bathroom"]
      })
    ]);

    expect(result).toEqual([
      {
        sha256: "a".repeat(64),
        score: 4,
        reason: "matched local metadata tokens: bright, shower"
      },
      {
        sha256: "b".repeat(64),
        score: 2,
        reason: "matched local metadata tokens: bathroom"
      }
    ]);
  });

  it("uses sha256 ascending as the stable score tie-break", async () => {
    const ranker = new LocalTextRanker();
    const result = await ranker.rank("gallery", [
      candidate({ sha256: "b".repeat(64), title: "gallery" }),
      candidate({ sha256: "a".repeat(64), title: "gallery" })
    ]);

    expect(result.map((entry) => entry.sha256)).toEqual(["a".repeat(64), "b".repeat(64)]);
  });

  it("returns repeatable order for identical inputs", async () => {
    const ranker = new LocalTextRanker();
    const candidates = [
      candidate({ sha256: "f".repeat(64), altText: "bright shower" }),
      candidate({ sha256: "e".repeat(64), title: "bright shower" }),
      candidate({ sha256: "0".repeat(64), description: "unrelated" })
    ];

    await expect(ranker.rank("bright shower", candidates)).resolves.toEqual(
      await ranker.rank("bright shower", candidates)
    );
  });
});
