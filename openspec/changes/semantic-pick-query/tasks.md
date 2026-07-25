# Tasks: Semantic `img pick` Query Support

## Review Workload Forecast

| Field                   | Value                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| Estimated changed lines | 900-1,300                                                             |
| 400-line budget risk    | High                                                                  |
| Chained PRs recommended | Yes                                                                   |
| Suggested split         | PR1 local/domain → PR2 AI adapter → PR3 wiring/tests → PR4 docs/gates |
| Delivery strategy       | ask-on-risk                                                           |
| Chain strategy          | stacked-to-main                                                       |

Decision needed before apply: No — maintainer selected chained PR delivery; current scope is PR1 / work unit 1 only.
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal                          | Likely PR | Notes                            |
| ---- | ----------------------------- | --------- | -------------------------------- |
| 1    | Domain seam + local ranker    | PR 1      | Independent; unit tests included |
| 2    | OpenAI-compatible text ranker | PR 2      | Depends on PR 1 types            |
| 3    | Pick service + CLI wiring     | PR 3      | Depends on PR 1-2                |
| 4    | E2E, gates, docs polish       | PR 4      | Final verification               |

## Phase 1: Foundation / Local Ranking

- [x] 1.1 Modify `src/adapters/vision/provider.ts` with `TextRankerProvider`, `RankingCandidateMeta`, and `RankingEntry`; reuse existing provider errors.
- [x] 1.2 Modify `src/domain/slot-matcher.ts` to add optional text fields, `eligible`, `opts.topK` default `3`, and stable `localTextScore(...)`.
- [x] 1.3 Create `src/adapters/vision/local-text-ranker.ts` with deterministic weighted token overlap and sha256 ASC tie-break; no I/O or provider calls.
- [x] 1.4 Add `test/domain/slot-matcher-text.test.ts` and `test/adapters/local-text-ranker.test.ts` for topK, eligible-only ranking, stopwords, and repeatable order.

## Phase 2: AI Text Ranker

- [ ] 2.1 Create `src/adapters/vision/text-ranker-openai-compat.ts` for metadata-only POST, cap 25/hard 50, strict zod JSON, redacted reason max 240.
- [ ] 2.2 Modify `src/app/runtime.ts` with `buildTextRankerProvider(root)` using existing provider config precedence; do not pass image paths or bytes.
- [ ] 2.3 Add `test/adapters/text-ranker-openai-compat.test.ts` for no `image_url`/base64, payload cap, malformed JSON, unknown sha, redaction, 429, timeout, and refusal.

## Phase 3: Pick Service / CLI Wiring

- [ ] 3.1 Modify `src/app/pick-service.ts` options/deps; map `ImageRecord` metadata, rank only eligible candidates when `query` exists, and emit success/no_candidate `ranking`.
- [ ] 3.2 In `src/app/pick-service.ts`, map AI provider errors to `ai_ranking_failed` exit `4`, with no local fallback and no ranking usage row.
- [ ] 3.3 Modify `src/commands/pick.ts` with `--query`, `--semantic local|ai`, `--top-k 1..10`, invalid-input exit `3`, default-local stderr note, and lazy ranker injection.
- [ ] 3.4 Add `test/app/pick-semantic-service.test.ts` and `test/commands/pick-semantic-options.test.ts` for default local, explicit AI, invalid topK, unchanged no-query path, and failure mapping.

## Phase 4: E2E / Verification

- [ ] 4.1 Extend `test/e2e/cli-flow.test.ts` for semantic flags, stderr default note, manifest `ranking`, AI failure, and no-query unchanged behavior.
- [ ] 4.2 Verify with `npm run typecheck`, `npm test`, `npm run build`, and `npm run lint`.
- [ ] 4.3 Confirm no DB migration, no new runtime dependency, and no source-image re-read/re-analysis path was introduced.
