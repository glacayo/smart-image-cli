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

## PR3 / Work Unit 3: Pick Service / CLI Wiring

Mode: Standard (OpenSpec `strict_tdd: false`; project test runner discovered via `package.json`)

### Completed Tasks

- [x] 3.1 Extended `src/app/pick-service.ts` options/deps with `query`, `semantic`, `topK`, and `textRanker`; mapped indexed metadata into slot candidates; ranked only `matchSlot(...).eligible` candidates when a query exists; emitted success and no-candidate `ranking` blocks.
- [x] 3.2 Mapped AI ranking/provider failures to structured `ai_ranking_failed` exit `4`, preserved no-local-fallback behavior for AI mode, skipped ranker calls when there are no eligible candidates, and kept usage recording limited to the final successful pick.
- [x] 3.3 Added `img pick` flags `--query <text>`, `--semantic local|ai`, and `--top-k <n>`; validated semantic/top-k input as `invalid_input` exit `3`; emitted the default-local stderr note when `--query` omits `--semantic`; wired local ranker by default and AI ranker through `buildTextRankerProvider(root)`.
- [x] 3.4 Added focused PR3 tests in `test/app/pick-semantic-service.test.ts` and `test/commands/pick-semantic-options.test.ts` for local defaulting, explicit AI metadata-only ranking, AI failure mapping, no-query behavior, no-eligible no-spend behavior, ranking output shape, and invalid option validation.

### PR Boundary

PR3 contains pick-service semantic orchestration, CLI option parsing/wiring, manifest ranking output, and focused app/command tests. It intentionally does not add PR4 e2e expansion, docs/doctor polish, archive work, or dependency-audit fixes.

### Verification

- `npm test -- test/app/pick-semantic-service.test.ts test/commands/pick-semantic-options.test.ts test/adapters/local-text-ranker.test.ts test/adapters/text-ranker-openai-compat.test.ts test/app/runtime-text-ranker-provider.test.ts` — passed (5 files, 29 tests).
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format` — passed after formatting source/test files, then passed as check.
- `npm test` — passed (25 files, 273 tests).
- `npm run build` — passed.
- `npm audit` — failed with the known 5 high-severity dev-dependency advisory chain through `eslint` / `@eslint/config-array` / `@eslint/eslintrc` / `minimatch` / `brace-expansion`; `npm audit fix --force` would install `eslint@10.8.0` as a breaking change, so no dependency changes were made in this PR3 scope.

### Remaining Risk

- PR3 is ready for review, but the repository audit gate remains blocked by the known dev-dependency advisory chain unrelated to semantic pick query wiring.
- Broad e2e CLI flow coverage, docs/doctor polish, final spec/archive verification, and no-migration/no-reanalysis final confirmation remain in PR4.

## PR3 Review Fix Batch

Mode: Standard. Scope remained PR3 / work unit 3 only: pick-service semantic output/failure semantics, CLI command wiring validation, focused service/command tests, and the redaction helper regression test. No PR4 e2e/docs/archive work, commits, pushes, or PR creation were performed.

### Review Findings Addressed

- [x] `ranking.query` is now redacted and bounded before structured output is returned; tests cover a secret-like long query and assert the raw value is not echoed.
- [x] Pick-service AI failure details are redacted again at the service boundary with `defaultSecretRedactor.maskValue(...)`, even for future/injected providers that throw `VisionProviderError` with unredacted `redactedDetails`.
- [x] AI-mode rankings that return an empty array or only non-eligible sha values for non-empty eligible input now fail loudly as `ai_ranking_failed` / exit `4`; local mode still keeps the deterministic no-ranked-candidate behavior.
- [x] Ranking blocks now include `status: "ranked" | "no_candidate"`; no-candidate ranking blocks no longer expose a misleading `topK`, while success ranking keeps the existing `topK` shape.
- [x] The CLI default-local stderr note now checks the parsed/validated semantic state (`parsed.semantic === undefined`) instead of raw commander option bags.
- [x] Registered-command tests now cover invalid `--semantic` and invalid `--top-k` as structured `invalid_input` / exit `3`, with no service or provider construction call.
- [x] Registered-command tests now cover explicit `--semantic ai` provider setup failure as structured `ai_ranking_failed` / exit `4`, with no service call when dependencies cannot be built.
- [x] AI success service coverage now proves ranking writes no extra usage/audit row; only the final successful `pick` usage event is present.
- [x] URL query-parameter redaction now preserves the parameter name while masking the value, preventing malformed `?=$3[REDACTED]` redaction output.

### Verification

- `npm test -- test/app/pick-semantic-service.test.ts test/commands/pick-semantic-options.test.ts test/adapters/secret-redactor.test.ts test/adapters/local-text-ranker.test.ts test/adapters/text-ranker-openai-compat.test.ts test/app/runtime-text-ranker-provider.test.ts` — passed (6 files, 54 tests).
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format` — initially reported formatting drift in `src/adapters/secret-redactor.ts`, `src/app/pick-service.ts`, and `src/commands/pick.ts`; after Prettier write, `npm run format` passed.
- First `npm test` full run — one known/flaky 5s timeout in `test/integration/optimization-flow.test.ts` (`strips GPS and descriptive metadata by default`).
- `npm test -- test/integration/optimization-flow.test.ts` — passed on focused rerun (6 tests).
- Second `npm test` full run — passed (25 files, 280 tests).
- `npm run build` — passed.
- `npm audit` — failed with the known 5 high-severity dev-dependency advisory chain through `eslint` / `@eslint/config-array` / `@eslint/eslintrc` / `minimatch` / `brace-expansion`; `npm audit fix --force` would install `eslint@10.8.0` as a breaking change, so no dependency changes were made in this PR3 review-fix scope.

### Remaining Risk

- PR3 is ready for re-review after the review-fix batch, but the repository audit gate remains blocked by the known dev-dependency advisory chain unrelated to semantic pick query wiring.
- PR4 still owns broad e2e CLI flow coverage, docs/doctor polish, final spec/archive verification, and no-migration/no-reanalysis final confirmation.

## PR4 / Work Unit 4: E2E / Verification / Docs Polish

Mode: Standard (OpenSpec `strict_tdd: false`; project test runner discovered via `package.json`)

### Completed Tasks

- [x] 4.1 Extended `test/e2e/cli-flow.test.ts` with semantic local CLI coverage for `--query`, default-local stderr note, `--top-k`, success manifest `ranking`, and no-query constraint-path output without `ranking`; added semantic AI e2e coverage with a stubbed provider payload and AI failure coverage proving `ai_ranking_failed` without local fallback.
- [x] 4.2 Ran focused PR4 e2e tests plus full gates: `npm run typecheck`, `npm run lint`, `npm run format`, `npm test`, `npm run build`, and `npm audit`.
- [x] 4.3 Confirmed this PR4 batch added no DB/schema migration, no new runtime dependency, and no source-image re-read/re-analysis path for semantic ranking; AI e2e asserts provider payloads contain metadata only and no `image_url`, `data:image`, `imageBytes`, or source image paths.

### Docs Polish

- Added README usage docs for `img pick --query`, `--semantic local|ai`, `--top-k`, local default behavior, explicit metadata-only AI mode, no image re-read/re-analysis, and loud `ai_ranking_failed` behavior.

### PR Boundary

PR4 contains final semantic pick e2e coverage, README usage polish, OpenSpec task/progress updates, and verification evidence. It does not archive the OpenSpec change, create commits/PRs, add dependencies, change database schema, or modify runtime semantic ranking logic.

### Verification

- `npm test -- test/e2e/cli-flow.test.ts` — passed (1 file, 10 tests).
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format` — passed.
- `npm test` — passed (25 files, 283 tests).
- `npm run build` — passed.
- `npm audit` — failed with the known 5 high-severity dev-dependency advisory chain through `brace-expansion` / `minimatch` / `@eslint/config-array` / `@eslint/eslintrc` / `eslint`; `npm audit fix --force` would install `eslint@10.8.0` as a breaking change, so no dependency changes were made in this PR4 scope.

### Remaining Risk

- The implementation and final e2e/doc polish are complete, but the repository audit gate remains blocked by the known dev-dependency advisory chain unrelated to semantic pick query runtime behavior.
- Archive remains intentionally deferred until after final merge/verify.

## PR4 Review Fix Batch

Mode: Standard. Scope remained PR4 / work unit 4 only: e2e assertion hardening and OpenSpec progress documentation. No archive, commits, pushes, PR creation, dependency fixes, runtime code changes, or doctor diagnostic implementation were performed.

### Review Finding Addressed

- [x] Replaced the vacuous no-fallback assertion against the phantom substring `matches query tokens` with structural failure assertions: provider-error exit `4`, structured `{ ok: false, status: "failed", command: "pick", reason: "ai_ranking_failed" }`, provider failure kind `RateLimit`, no success `manifest`/`ranking` payload, no local-mode ranking marker, no local-ranker sentinel reason `matched local metadata tokens`, and redacted provider failure output.

### Deferred Work

- Doctor diagnostics for semantic AI ranking remain deferred/out of scope for PR4 review-fix scope. This batch intentionally documents the deferral but does not implement new `doctor` checks.

### Verification

- `npm test -- test/e2e/cli-flow.test.ts` — passed (1 file, 10 tests).
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format` — passed.
- `npm test` — passed (25 files, 283 tests).
- `npm run build` — passed.
- `npm audit` — failed with the known 5 high-severity dev-dependency advisory chain through `brace-expansion` / `minimatch` / `@eslint/config-array` / `@eslint/eslintrc` / `eslint`; `npm audit fix --force` would install `eslint@10.8.0` as a breaking change, so no dependency changes were made in this PR4 review-fix scope.

### Remaining Risk

- PR4 is ready for re-review after the assertion hardening batch, but the repository audit gate remains blocked by the known dev-dependency advisory chain unrelated to semantic pick query runtime behavior.
- Archive remains intentionally deferred until after final merge/verify.

## Pre-Archive Warning Fix Batch

Mode: Standard. Scope was limited to final verification warning cleanup before archive. No OpenSpec archive, commit, push, PR creation, runtime dependency change, or semantic ranking behavior change was performed.

### Warnings Addressed

- [x] Resolved the `npm audit` high-severity dev-dependency advisory chain by upgrading dev-only lint tooling to `eslint@^10.8.0`, `@eslint/js@^10.0.1`, and `typescript-eslint@^8.65.0`; lockfile was updated and runtime dependencies were left unchanged.
- [x] Added `@fission-ai/openspec@^1.6.0` as a devDependency and `npm run openspec:validate -- <change>` as the project-local strict OpenSpec validation command.
- [x] Wrapped OpenSpec validation through `scripts/openspec-validate.mjs` so validation runs with telemetry disabled (`OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1`) instead of allowing default analytics egress from developer machines.
- [x] Updated the README status table so storage/adapters, application services, provider adapters, and semantic pick query support are no longer shown as pending/stale.
- [x] Fixed three ESLint 10 `no-useless-assignment` findings without changing behavior: URL secret-param decoding now uses definite assignment, and SQLite rebuild returns `atomic: true` after a successful transaction.

### Verification

- `npm run typecheck` — passed.
- `npm run lint` — passed after fixing ESLint 10 `no-useless-assignment` findings.
- `npm run format` — initially reported formatting drift after dependency/script/source edits; passed after Prettier write.
- `npm test` — passed (25 files, 283 tests).
- `npm run build` — passed.
- `npm audit` — passed, 0 vulnerabilities.
- `npm run openspec:validate -- semantic-pick-query` — passed: `Change 'semantic-pick-query' is valid`.

### Remaining Risk

- None from the final verification warnings. Archive can proceed without the previous `npm audit`, OpenSpec strict validation, or stale README warnings.

## Pre-Archive Warning Review Fix Batch

Mode: Standard. Scope remained warning-cleanup only. No archive, commit, push, PR creation, runtime dependency change, semantic ranking behavior change, or unrelated OpenSpec config migration was performed.

### Review Findings Addressed

- [x] Stabilized the e2e redaction test by isolating it from the real native ExifTool readiness probe; the test now stubs `exiftool.version()` because its assertions cover project-config rejection and doctor redaction, while ExifTool readiness has separate service-level coverage.
- [x] Added the requested SQLite rebuild readability comment: reaching the returned `atomic: true` means `tx()` committed because rollback paths throw before the return.
- [x] Documented that adding `@fission-ai/openspec` intentionally brings a dev-only transitive CLI footprint in `package-lock.json` (`@inquirer/*`, nested `zod`, and related CLI packages), so lockfile churn is expected and remains outside runtime dependencies.
- [x] Documented `npm run openspec:validate -- <change>` as a standalone/manual OpenSpec archive gate rather than a default build/test command.
- [x] Documented that `openspec list` still emits pre-existing legacy `openspec/config.yaml` rules-format warnings for `apply`/`verify`; those warnings are out of scope for this semantic-pick-query warning-cleanup chore.

### Verification

- `npm test -- test/e2e/cli-flow.test.ts` — passed 3 consecutive focused runs (10 tests each; durations 2.00s, 2.18s, 1.85s), proving the redaction e2e no longer depends on the real ExifTool probe timing.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format` — initially reported formatting drift in `src/adapters/sqlite-index.ts`; after Prettier write, passed.
- `npm test` — passed (25 files, 283 tests).
- `npm run build` — passed.
- `npm audit` — passed, 0 vulnerabilities.
- `npm run openspec:validate -- semantic-pick-query` — passed: `Change 'semantic-pick-query' is valid`.
- `npm exec -- openspec list` — still reports legacy rules-format warnings for `apply`/`verify`; documented as pre-existing/out-of-scope and not fixed in this warning-cleanup batch.

### Remaining Risk

- None from the review findings. The semantic-pick-query change remains ready for final review; archive is still intentionally not performed in this batch.

## Pre-Archive Flaky Test Fix Batch

Mode: Standard. Scope was limited to stabilizing the final verification timeout in `test/integration/optimization-flow.test.ts`. No archive, commit, push, PR creation, dependency change, runtime semantic ranking behavior change, or production code change was performed.

### Flake Addressed

- [x] Stabilized `strips GPS and descriptive metadata by default` by replacing the test's unnecessary real `exiftool-vendored` write/read path with a deterministic Sharp EXIF fixture and Sharp metadata assertion. The source fixture still contains EXIF with GPS and `ImageDescription`, and the optimized output is asserted to have no EXIF segment, preserving the privacy-stripping intent without paying native ExifTool startup inside this default-strip test.

### Verification

- `npm test -- test/integration/optimization-flow.test.ts -t "strips GPS and descriptive metadata by default"` — passed after the fix; focused test runtime dropped from ~949ms before the change to ~89ms after the change on this machine.
- `npm test -- test/integration/optimization-flow.test.ts` — passed 3 consecutive focused file runs (6 tests each; durations 2.78s, 2.84s, 2.80s).
- `npm test && npm test` — passed two consecutive full-suite runs (25 files, 283 tests each; durations 8.98s and 10.87s).
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format` — passed.
- `npm run build` — passed.
- `npm audit` — passed, 0 vulnerabilities.
- `npm run openspec:validate -- semantic-pick-query` — passed: `Change 'semantic-pick-query' is valid`.

### Remaining Risk

- None from the flaky timeout fix. Final archive verification can proceed cleanly; archive was intentionally not performed in this batch.
