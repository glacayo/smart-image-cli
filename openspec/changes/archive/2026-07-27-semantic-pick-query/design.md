# Design: Semantic `img pick` Query Support

## Technical Approach

Add a `TextRankerProvider` seam behind `pickService`. The constraint match (`matchSlot`) runs unchanged; when `--query` is present, the constraint-**eligible** list is re-ranked by a text ranker: a pure local token-overlap scorer (default) or a text-only OpenAI-compatible adapter (explicit `--semantic ai`). Ranking consumes ONLY existing `ImageRecord.classification` metadata already returned by `SqliteIndex.query()` — no image bytes, no re-analysis, no DB migration. Implements delta specs `image-selection` and `ai-provider`.

## Architecture Decisions

| Decision | Options | Tradeoff | Chosen |
|---|---|---|---|
| Ranker contract | (a) reuse `VisionProvider`; (b) sibling `TextRankerProvider` | (a) bakes in "sends an image"; (b) one extra interface but honest contract | **(b)** — vision bytes can never travel on the pick path |
| Error taxonomy | (a) reuse `VisionProviderError` classes; (b) new parallel hierarchy | (a) slight naming noise; (b) duplicated taxonomy | **(a)** — same kinds (RateLimit/Timeout/Refusal/MalformedOutput), single mapping to exit 4 |
| Ranker injection | (a) build inside service; (b) inject via `PickDeps` | (b) matches existing `PickDeps.index` pattern, testable | **(b)** — command layer builds AI ranker lazily, only on `--semantic ai` |
| Eligible-list exposure | (a) re-derive via `explainCandidate` in service; (b) additive `eligible` field on `SlotMatchResult` | (a) duplicates filtering; (b) additive, single source of truth | **(b)** |
| AI model | configured vision provider/model (v1) | may be suboptimal at text ranking; zero new config | **Reuse for v1**; text-ranker override documented as future work |
| Ranking usage/audit row | write vs skip | ranking is a read, not a pick | **Skip** — only the final pick writes usage (spec: "Ranking records no usage") |

## Data Flow

    pick.ts ──parse/validate──▶ pickService(root, opts, deps)
                                     │
                        SqliteIndex.query() → ImageRecord[]
                                     │
                        matchSlot(candidates, request, {topK})
                                     │ eligible[] (constraint-satisfying only)
              ┌── no --query ──▶ eligible[0] (unchanged path)
              │
              └── --query ──▶ deps.textRanker.rank(query, metas)
                       local: pure localTextScore (no I/O)
                       ai:    POST /chat/completions (text-only, capped 25/50)
                                     │ RankingEntry[] (strict JSON, zod)
                          selected = rank[0] → planResize → produce → appendUsage
                                     │
                          manifest + ranking {mode, query, reason, score, topK, alternatives}
                       AI throw ──▶ ai_ranking_failed, exit 4, NO local fallback

## File Changes

| File | Action | Description |
|---|---|---|
| `src/commands/pick.ts` | Modify | Add `--query <text>`, `--semantic <mode>` (validate `local\|ai`), `--top-k <n>` (int 1..10) → `invalid_input`/exit 3. `--query` without `--semantic`: stderr note "defaulted to --semantic local". Build `LocalTextRanker` or `OpenAICompatTextRanker` and pass via `PickDeps`. |
| `src/app/pick-service.ts` | Modify | Extend `PickOptions` (`query?`, `semantic?`, `topK?`) and `PickDeps` (`textRanker?`). Rank eligible candidates when `query` set; thread `ranking` block into success manifest and `no_candidate` payload; map `VisionProviderError` → `ai_ranking_failed` + `EXIT_CODES.PROVIDER_ERROR`. |
| `src/domain/slot-matcher.ts` | Modify | Additive: optional text fields on `SlotCandidate` (`subject?, title?, description?, altText?`); `matchSlot(..., opts?: {topK?: number})` replaces hard-coded 3 in `alternativesFor` (default stays 3); result gains `eligible: SlotAlternative[]`; pure `localTextScore(candidate, queryTokens): number`. |
| `src/adapters/vision/provider.ts` | Modify | Add `TextRankerProvider` interface + `RankingCandidateMeta`, `RankingEntry` types. Errors reused as-is. |
| `src/adapters/vision/local-text-ranker.ts` | Create | `LocalTextRanker implements TextRankerProvider`. Tokenize (lowercase, strip punctuation, stopword set), weighted field overlap (subject 3, title/categories 2, altText/description 1), sha256 ASC tie-break. Pure, no I/O, no spend. |
| `src/adapters/vision/text-ranker-openai-compat.ts` | Create | Text-only POST to same endpoint; `response_format: json_object`; payload cap default 25 / hard 50; prompt frames metadata as DATA in delimited block, forbids following embedded instructions; zod-parse `{rankings: {sha256, score(0..1), reason(max 240)}[]}`; truncate + `defaultSecretRedactor.mask` each `reason`; unknown sha256 → `MalformedOutputProviderError`. Mirrors `openai-compat.ts` timeout/abort/429/refusal handling. |
| `src/app/runtime.ts` | Modify | `buildTextRankerProvider(root)` helper — same config precedence as `analyze.ts#buildProvider` (project.provider → user provider → preset), no image path. |

## Interfaces / Contracts

```ts
// provider.ts (additive)
export type RankingCandidateMeta = {
  sha256: string; subject: string; title: string;
  description: string; altText: string; categories: readonly string[];
};
export type RankingEntry = { sha256: string; score: number; reason: string };
export interface TextRankerProvider {
  readonly id: string;
  rank(query: string, candidates: readonly RankingCandidateMeta[]): Promise<RankingEntry[]>;
}
```

Manifest addition (success): `ranking: { mode: "local"|"ai", query, reason, score, topK, alternatives: {sha256, score, reason}[] }` — alternatives are the next `topK` ranked entries after the selection. `no_candidate` keeps `alternatives` (bounded by `topK`) and adds `ranking` with `reason: "no_candidate"` when semantic is set.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | `localTextScore` determinism, stopwords, sha256 tie-break; `matchSlot` topK + `eligible` | `test/domain/slot-matcher-text.test.ts` — golden ordered fixtures, run-twice equality |
| Unit | `LocalTextRanker` ordering; `--top-k`/`--semantic` validation | `test/adapters/local-text-ranker.test.ts`, `test/commands/pick-semantic-options.test.ts` |
| Unit | AI adapter: no `image_url` in body, cap 25/50, strict JSON reject, reason truncation+redaction, 429/timeout/refusal mapping | `test/adapters/text-ranker-openai-compat.test.ts` with `fetchImpl` stub (existing pattern) |
| Integration | Mode branching, `ai_ranking_failed` exit 4 + no fallback, no usage row for ranking, constraint-only path byte-identical | `test/app/pick-semantic-service.test.ts` with injected `PickDeps` |
| E2E | Flags end-to-end, stderr default note, manifest `ranking` block | extend `test/e2e/cli-flow.test.ts` |

## Migration / Rollout

No DB/schema migration (metadata already indexed). Fully flag-gated: without `--query` behavior is byte-for-byte current. Rollback = remove three flags + service branch; new adapters become unreferenced. Suggested slicing per proposal PR1–PR4 (domain+local ranker → AI adapter → CLI wiring → docs/archive).

## Open Questions

- [ ] None blocking. Future (recorded, out of scope): per-project text-ranker model override; doctor diagnostic for payload-cap hits.
