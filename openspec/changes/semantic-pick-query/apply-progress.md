# Apply Progress: Semantic `img pick` Query Support

## PR1 / Work Unit 1: Foundation / Local Ranking

Mode: Standard (OpenSpec `strict_tdd: false`; project test runner discovered via `package.json`)

### Completed Tasks

- [x] 1.1 Added `TextRankerProvider`, `RankingCandidateMeta`, and `RankingEntry` to `src/adapters/vision/provider.ts`; existing provider errors remain reused and unchanged.
- [x] 1.2 Extended `SlotCandidate` with optional indexed text metadata, added `SlotMatchResult.eligible`, added `matchSlot(..., { topK })` with default `3`, and added deterministic local text token scoring primitives.
- [x] 1.3 Added `src/adapters/vision/local-text-ranker.ts` as a pure local ranker with weighted token overlap and sha256 ascending tie-break.
- [x] 1.4 Added focused unit tests for tokenization/stopwords, metadata weighting, eligible-only exposure, top-k bounds, sha256 tie-break, and repeatable local ordering.

### PR Boundary

PR1 contains only the domain seam, local ranker, and focused unit tests. It does not implement the AI adapter, CLI flags, pick-service semantic wiring, or provider calls.

### Verification

- `npm test -- test/domain/slot-matcher.test.ts test/domain/slot-matcher-text.test.ts test/adapters/local-text-ranker.test.ts` — passed (3 files, 20 tests).
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format` — passed after formatting touched source files.
- First `npm test` full run — one pre-existing/flaky integration timeout in `test/integration/optimization-flow.test.ts` (`strips GPS and descriptive metadata by default`).
- `npm test -- test/integration/optimization-flow.test.ts` — passed on focused rerun.
- Second `npm test` full run — passed (21 files, 238 tests).
- `npm run build` — passed.
- `npm audit` — passed, 0 vulnerabilities.

## PR1 Review Fix Batch

Mode: Standard. Scope remained PR1 / work unit 1 only: domain matching, local text ranking, tests, and OpenSpec artifact corrections. No AI adapter, CLI flags, pick-service semantic wiring, runtime changes, commits, pushes, or PR creation were added.

### Review Findings Addressed

- [x] Local ranker reasons now report the actual query tokens that appear in each candidate's metadata instead of echoing the full query token list.
- [x] Local scoring tests pin field weights: subject `3`, title `2`, categories `2`, altText `1`, description `1`, including additive behavior across fields.
- [x] `SlotMatchResult.eligible` contract is documented as the complete, unbounded constraint-eligible list sorted by slot score; `topK` only caps `alternatives`.
- [x] `SlotMatchOptions.topK` is validated at the domain boundary and throws `RangeError` for zero, negative, or non-integer values.
- [x] Local text scoring APIs are split into raw-query and pre-tokenized variants: `localTextScore(...)` and `localTextScoreForTokens(...)`; matched-token helpers mirror the same split.
- [x] Eligibility tests now cover category mismatch, orientation mismatch, dimension deficit, and used/reuse behavior.
- [x] Tokenization tests now cover accents/unicode normalization and numeric tokens.
- [x] Stale OpenSpec artifacts were updated: chain strategy set to `stacked-to-main`, `suggestedSlug` drift clarified as out of v1 local ranking, and this review-fix batch recorded.

### Verification

- `npm test -- test/domain/slot-matcher.test.ts test/domain/slot-matcher-text.test.ts test/adapters/local-text-ranker.test.ts` — passed (3 files, 30 tests).
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format` — passed after formatting touched PR1 source/tests/artifacts.
- First `npm test` full run — one pre-existing/flaky integration timeout in `test/integration/optimization-flow.test.ts` (`strips GPS and descriptive metadata by default`).
- `npm test -- test/integration/optimization-flow.test.ts` — passed on focused rerun (6 tests).
- Second `npm test` full run — passed (21 files, 248 tests).
- `npm run build` — passed.
- `npm audit` — failed with 5 high-severity advisories through `eslint`/`@eslint/config-array`/`@eslint/eslintrc`/`minimatch`/`brace-expansion`; `npm audit fix --force` would install `eslint@10.8.0` as a breaking change, so no dependency changes were made in this PR1 review-fix scope.

### Remaining Risk

- The PR1 code/test changes are ready for re-review, but the repository audit gate is not clean until the pre-existing dev-dependency advisory chain is addressed in a separate dependency-maintenance scope.
