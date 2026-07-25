import {
  localTextMatchedTokensForTokens,
  localTextScoreForTokens,
  semanticTextTokens
} from "../../domain/slot-matcher.js";
import type { RankingCandidateMeta, RankingEntry, TextRankerProvider } from "./provider.js";

export class LocalTextRanker implements TextRankerProvider {
  readonly id = "local";

  async rank(query: string, candidates: readonly RankingCandidateMeta[]): Promise<RankingEntry[]> {
    const queryTokens = semanticTextTokens(query);

    return candidates
      .map((candidate) => {
        const score = localTextScoreForTokens(candidate, queryTokens);
        return {
          sha256: candidate.sha256,
          score,
          reason: localReason(
            score,
            queryTokens,
            localTextMatchedTokensForTokens(candidate, queryTokens)
          )
        };
      })
      .sort((a, b) => b.score - a.score || a.sha256.localeCompare(b.sha256));
  }
}

function localReason(
  score: number,
  queryTokens: readonly string[],
  matchedTokens: readonly string[]
): string {
  if (queryTokens.length === 0) {
    return "no rankable query tokens";
  }
  if (score === 0) {
    return "no local metadata token overlap";
  }
  return `matched local metadata tokens: ${matchedTokens.join(", ")}`;
}
