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

## PR2 / Work Unit 2: AI Text Ranker Adapter

Mode: Standard (OpenSpec `strict_tdd: false`; project test runner discovered via `package.json`)

### Completed Tasks

- [x] 2.1 Added `src/adapters/vision/text-ranker-openai-compat.ts` as an OpenAI-compatible metadata-only `TextRankerProvider` with text-only chat payloads, default 25-candidate cap, hard 50-candidate cap, strict zod JSON response validation, unknown/duplicate sha rejection, typed provider errors, bounded prompts, and redacted/bounded model reasons.
- [x] 2.2 Added `buildTextRankerProvider(root)` to `src/app/runtime.ts` using the same provider precedence as the vision analyzer (`project.provider` overrides, then user provider config, then presets) while passing only endpoint/model/key config and no image paths or bytes.
- [x] 2.3 Added `test/adapters/text-ranker-openai-compat.test.ts` covering successful ranking, metadata-only payloads with no `image_url`/base64/data URLs, default/hard payload caps, malformed/schema-invalid/unknown-sha responses, existing provider error taxonomy for 429/timeout/refusal, and redacted/bounded reasons.

### PR Boundary

PR2 contains only the AI metadata-only text ranker adapter, a runtime construction helper, and focused adapter tests. It does not implement CLI flags, pick-service semantic branching, runtime command wiring, manifest ranking output, or e2e flows.

### Verification

- `npm test -- test/adapters/text-ranker-openai-compat.test.ts` — passed (1 file, 5 tests).
- `npm test -- test/adapters/openai-compat.test.ts test/adapters/local-text-ranker.test.ts test/adapters/text-ranker-openai-compat.test.ts` — passed (3 files, 17 tests).
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format` — passed after formatting PR2 source/tests.
- First `npm test` full run — one pre-existing/flaky integration timeout in `test/integration/optimization-flow.test.ts` (`strips GPS and descriptive metadata by default`).
- `npm test -- test/integration/optimization-flow.test.ts` — passed on focused rerun (6 tests).
- Second `npm test` full run — passed (22 files, 253 tests).
- `npm run build` — passed.
- `npm audit` — failed with 5 high-severity advisories through `eslint`/`@eslint/config-array`/`@eslint/eslintrc`/`minimatch`/`brace-expansion`; `npm audit fix --force` would install `eslint@10.8.0` as a breaking change, so no dependency changes were made in this PR2 scope.

### Remaining Risk

- PR2 code/test changes are complete, but the repository audit gate remains blocked by the known dev-dependency advisory chain unrelated to semantic ranking.
- PR2 changed-line size is slightly above the preferred 400-line review budget because the new adapter and its focused tests are a single cohesive seam; if the maintainer wants a stricter slice, split runtime helper wiring into PR3 and keep PR2 adapter-only.

## PR2 Review Fix Batch

Mode: Standard. Scope remained PR2 / work unit 2 only: AI metadata-only text ranker adapter, runtime construction helper, shared OpenAI-compatible transport extraction, and focused tests. No CLI flags, pick-service semantic branching, e2e expansion, commits, pushes, or PR creation were added.

### Review Findings Addressed

- [x] Timeout behavior is now covered with a deterministic fake-timer test that lets a hung fetch observe a real `AbortSignal`, rejects with `TimeoutProviderError`, and asserts timer cleanup.
- [x] `buildTextRankerProvider(root)` now has focused temp-config tests for provider/model precedence, preset fallback endpoint/model selection, missing API key failures, metadata-only/no-image payload construction, and the credential-routing guard.
- [x] Credential routing risk is mitigated for the text-ranker helper: project-selected provider/model still apply, but project-controlled custom endpoint overrides are rejected for text ranking so a checked-in endpoint cannot receive a user-scoped key. Existing vision analyze behavior remains unchanged.
- [x] OpenAI-compatible fetch/error/timeout/refusal/text-content/JSON-fence handling was extracted to `src/adapters/vision/openai-compat-transport.ts` and reused by both the vision analyzer adapter and text ranker adapter.
- [x] Provider config precedence duplication was consolidated in `resolveProviderConfig(root)`. `analyze.ts` uses it with legacy endpoint behavior; the text ranker uses it with project endpoint overrides disabled.
- [x] Malformed response, schema-invalid response, unknown sha, and duplicate sha branches now have split tests with branch-specific assertions where applicable.
- [x] Prompt/payload bounds and prompt-injection guardrails are tested: oversized query/metadata/categories are bounded, metadata remains in the user data payload, and malicious instruction-like metadata does not alter the system message.
- [x] Empty candidate behavior is tested: `rank(...)` returns `[]` and does not call `fetch`.
- [x] `TextRankerProvider` JSDoc now clarifies cardinality: partial rankings are valid, omitted candidates are unranked, local returns all candidates, and Phase 3 must not invent scores for missing candidates.

### Deferred Work

- No critical duplication deferral remains for PR2. Broader provider-config migration can still continue later, but the extracted `resolveProviderConfig(root)` is already used by analyze construction and text-ranker construction without changing analyze endpoint behavior.

### Verification

- `npm test -- test/adapters/text-ranker-openai-compat.test.ts test/app/runtime-text-ranker-provider.test.ts test/adapters/openai-compat.test.ts test/adapters/local-text-ranker.test.ts` — passed (4 files, 27 tests).
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format` — passed after formatting source/tests.
- First `npm test` full run — two known/flaky 5s timeouts: `test/e2e/cli-flow.test.ts` (`keeps project config secret-safe and doctor output redacted`) and `test/integration/optimization-flow.test.ts` (`strips GPS and descriptive metadata by default`).
- `npm test -- test/e2e/cli-flow.test.ts test/integration/optimization-flow.test.ts` — passed on focused rerun (2 files, 13 tests).
- Second `npm test` full run — passed (23 files, 263 tests).
- `npm run build` — passed.
- `npm audit` — failed with 5 high-severity advisories through `eslint`/`@eslint/config-array`/`@eslint/eslintrc`/`minimatch`/`brace-expansion`; `npm audit fix --force` would install `eslint@10.8.0` as a breaking change, so no dependency changes were made in this PR2 review-fix scope.

### Remaining Risk

- PR2 is ready for re-review, but the repository audit gate remains blocked by the known dev-dependency advisory chain unrelated to semantic ranking.
- The text ranker intentionally rejects project-config endpoint overrides until a future trusted-project-endpoint model exists; users must place custom provider endpoints in user config so endpoint and API key share the same trust boundary.
