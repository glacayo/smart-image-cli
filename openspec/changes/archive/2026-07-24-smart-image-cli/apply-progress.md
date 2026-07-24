# Apply Progress: Smart Image CLI

## Mode

Standard (OpenSpec). `strict_tdd: false` in `openspec/config.yaml`.

## Workload / PR Boundary

- Delivery mode: chained PR slice / work unit 3 only
- Boundary: Phase 3 application services on branch `feat/pr3-application-services`; no commit, push, PR, archive, or Phase 4 broad e2e suite was created in this apply batch
- Chain strategy: pending in `tasks.md`; the user explicitly assigned PR3/work unit 3 for this batch
- Scope guard: Phase 3 services and focused app/adapter tests only; Phase 4 broad integration/e2e suite remains pending
- Latest batch: chained PR slice / work unit 4 only on branch `feat/pr4-verification`; added broad verification/e2e coverage and fixed only blockers exposed by Phase 4 tests. No commit, push, PR, merge, or archive was performed.

## Completed Tasks

- [x] 1.1 Created Node 22 ESM TypeScript tooling with `img` bin and scripts for `test`, `lint`, `format`, and `typecheck`.
- [x] 1.2 Created CLI program/output/exit-code modules and thin command handlers for `analyze`, `optimize`, `pick`, `mark-used`, `list`, `stats`, `config`, and `doctor`.
- [x] 1.3 Created shipped taxonomy and user/project config contracts; provider secrets are modeled only in per-user config and explicitly rejected from project config.
- [x] 1.4 Implemented pure domain modules for path guarding, generated-dir exclusion, slug naming, resize planning, slot matching, taxonomy, and analysis schema.
- [x] 2.1 Implemented `SidecarStore` with per-sha promise serialization, durable temp-file writes, file fsync, atomic rename, and directory fsync best-effort for platforms that support it.
- [x] 2.2 Normalized sidecar primary policy so `canonicalRelPath` is always included as `occurrences[0]` with `primaryFlag: "canonicalRelPath"`; rebuild primary selection promotes the first live sha-verified occurrence when the stored canonical path is missing or stale.
- [x] 2.3 Implemented `SqliteIndex` with rebuildable content/occurrence tables, live-occurrence sha verification during rebuild, append-event/dedupe-record usage replay, and stats totals exposing both raw `usageEvents` and deduped `usageRecords`.
- [x] 2.4 Implemented Sharp, ExifTool, and OpenAI-compatible vision adapters with typed decode/write/metadata/provider errors plus centralized secret redaction for provider diagnostics.
- [x] 3.1 Implemented `AnalyzeService` with generated-dir-aware recursive walking, symlink/root guard validation, sha256 dedupe, dry-run no-write behavior, sidecar cache hits, and unique organized destinations for duplicate occurrences.
- [x] 3.2 Implemented `OptimizeService` with guarded input probing, explicit no-upscale planning, crop/resize/convert output through `SharpProcessor`, metadata strip-by-default, opt-in metadata reapply, and guarded `_out/` output writes.
- [x] 3.3 Implemented `PickService` with index-read rebuild gating, slot constraint matching, close alternatives on no-match, explicit no-upscale planning, output manifest production, durable usage append, SQLite usage update, and output rollback if usage recording fails.
- [x] 3.4 Implemented `mark-used`, `list`, `stats`, `config`, and `doctor` app services plus command routing; `mark-used --path` validates through root/path guards before existence and index lookup and returns stable `not_found` semantics.
- [x] 4.1 Added domain verification for path traversal rejection, segment-aware generated-asset exclusion without `_outdoor` overmatch, no-upscale resize planning, bounded downscale planning, and safe slug/collision filename generation.
- [x] 4.2 Added integration verification for recursive discovery, generated-output exclusion, duplicate collapse before AI, sidecar persistence, second-run cache reuse, and SQLite rebuild after database loss.
- [x] 4.3 Added optimization verification for AVIF conversion, source preservation, default GPS/metadata stripping, explicit metadata opt-in, EXIF orientation tag normalization, no-upscale failure, and bounded downscale output dimensions.
- [x] 4.4 Added e2e CLI verification for single-object JSON stdout, optimize/pick/mark-used/list/stats/config/doctor flows, stable no-match vs invalid-input exit codes, path-guard failures, analyze dry-run no-write safety under missing provider config, and doctor/config secret non-leak behavior.

## Verification

| Command | Result |
|---------|--------|
| `npm install` | Passed; initial dev audit warnings found |
| `npm install -D vitest@^4.1.10` | Passed; updated dev test dependency to remove audit vulnerabilities |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run format` | Passed |
| `npm test` | Passed; no test files initially, `--passWithNoTests` configured for Phase 1 tooling only |
| `npm audit` | Passed; 0 vulnerabilities |
| `npm run build` | Passed |
| `npm install sharp exiftool-vendored better-sqlite3` | Passed; added Phase 2 runtime native adapters; 0 vulnerabilities |
| `npm install -D @types/better-sqlite3` | Passed; added TypeScript declarations for `better-sqlite3`; 0 vulnerabilities |
| `npm run typecheck` | Passed after Phase 2 adapter implementation |
| `npm exec prettier -- --write "src/adapters/**/*.ts"` | Passed; formatted Phase 2 adapter source |
| `npm run format` | Passed after formatting Phase 2 adapter source |
| `npm run lint` | Passed after Phase 2 adapter implementation |
| `npm test` | Passed; 10 test files / 87 tests (current live count after all PR2 review-fix batches) |
| `npm run build` | Passed after Phase 2 adapter implementation and review fixes |
| `npm audit` | Passed; 0 vulnerabilities after Phase 2 dependencies and review fixes |
| `npm run typecheck` | Passed after Phase 3 application services |
| `npm run lint` | Passed after Phase 3 application services |
| `npm exec prettier -- --write "src/app/**/*.ts" "src/commands/*.ts" "test/app/**/*.ts"` | Passed; formatted PR3 files only |
| `npm test` | Passed; 14 test files / 115 tests after PR3 review-fix batch |
| `npm run format` | Failed on pre-existing non-PR3 files (`package*.json`, `vitest.config.ts`, `src/adapters/**`, `src/adapters/vision/**`); PR3 files were formatted, but the full repository format script still reports earlier files |
| `npm run build` | Passed after Phase 3 application services |
| `npm audit` | Passed; 0 vulnerabilities |
| `npm test` | Passed; 15 test files / 161 tests after PR3 final-fix batch |
| `npm run typecheck` | Passed after PR3 final-fix batch |
| `npm run lint` | Passed after PR3 final-fix batch |
| `npm run format` | Passed after PR3 final-fix batch |
| `npm run build` | Passed after PR3 final-fix batch |
| `npm audit` | Passed; 0 vulnerabilities after PR3 final-fix batch |
| `npm test` | Passed; 15 test files / 164 tests after PR3 clean-gate fix batch |
| `npm run typecheck` | Passed after PR3 clean-gate fix batch |
| `npm run lint` | Passed after PR3 clean-gate fix batch |
| `npm run format` | Passed after PR3 clean-gate fix batch |
| `npm run build` | Passed after PR3 clean-gate fix batch |
| `npm audit` | Passed; 0 vulnerabilities after PR3 clean-gate fix batch |
| `npm test` | Passed; 15 test files / 174 tests after PR3 risk-fix batch |
| `npm run typecheck` | Passed after PR3 risk-fix batch |
| `npm run lint` | Passed after PR3 risk-fix batch |
| `npm run format` | Passed after PR3 risk-fix batch |
| `npm run build` | Passed after PR3 risk-fix batch |
| `npm audit` | Passed; 0 vulnerabilities after PR3 risk-fix batch |
| `npm test` | Passed; 15 test files / 180 tests after PR3 fragment-token risk-fix batch |
| `npm run typecheck` | Passed after PR3 fragment-token risk-fix batch |
| `npm run lint` | Passed after PR3 fragment-token risk-fix batch |
| `npm run format` | Passed after PR3 fragment-token risk-fix batch |
| `npm run build` | Passed after PR3 fragment-token risk-fix batch |
| `npm audit` | Passed; 0 vulnerabilities after PR3 fragment-token risk-fix batch |
| `npm test` | Passed; 15 test files / 197 tests after PR3 final risk-fix batch 2 |
| `npm run typecheck` | Passed after PR3 final risk-fix batch 2 |
| `npm run lint` | Passed after PR3 final risk-fix batch 2 |
| `npm run format` | Passed after PR3 final risk-fix batch 2 |
| `npm run build` | Passed after PR3 final risk-fix batch 2 |
| `npm audit` | Passed; 0 vulnerabilities after PR3 final risk-fix batch 2 |
| `npm test` | Passed; 15 test files / 205 tests after PR3 risk-fix batch 3 |
| `npm run typecheck` | Passed after PR3 risk-fix batch 3 |
| `npm run lint` | Passed after PR3 risk-fix batch 3 |
| `npm run format` | Passed after PR3 risk-fix batch 3 |
| `npm run build` | Passed after PR3 risk-fix batch 3 |
| `npm audit` | Passed; 0 vulnerabilities after PR3 risk-fix batch 3 |
| `npm test` | Passed before PR4 edits; 15 test files / 205 tests baseline |
| `npm test` | Passed after PR4 verification; 19 test files / 227 tests |
| `npm run typecheck` | Passed after PR4 verification and blocker fixes |
| `npm run lint` | Passed after PR4 verification and blocker fixes |
| `npm run format` | Passed after adding `endOfLine: auto` and formatting the PR4-touched source files |
| `npm run build` | Passed after PR4 verification and blocker fixes |
| `npm audit` | Passed; 0 vulnerabilities after PR4 verification |
| `npm test` | Passed after PR4 review-fix batch; 19 test files / 231 tests |
| `npm run typecheck` | Passed after PR4 review-fix batch |
| `npm run lint` | Passed after PR4 review-fix batch |
| `npm run format` | Passed after PR4 review-fix batch |
| `npm run build` | Passed after PR4 review-fix batch |
| `npm audit` | Passed; 0 vulnerabilities after PR4 review-fix batch |
| `npm test` | Passed after PR4 reliability-fix batch; 19 test files / 231 tests (count unchanged) |
| `npm run typecheck` | Passed after PR4 reliability-fix batch |
| `npm run lint` | Passed after PR4 reliability-fix batch |
| `npm run format` | Passed after PR4 reliability-fix batch |
| `npm run build` | Passed after PR4 reliability-fix batch |
| `npm audit` | Passed; 0 vulnerabilities after PR4 reliability-fix batch |

## PR4 Reliability-Fix Batch (applied on `feat/pr4-verification`)

The following confirmed PR4 reliability finding was applied test-only, without source changes, Phase 4 archive, commit, push, or PR:

- **Path traversal e2e can false-pass**: `test/e2e/cli-flow.test.ts` "optimizes through the CLI and rejects path traversal without writes" previously wrote the outside-root sentinel as plain text (`escape.jpg` containing `"outside-sentinel-before-traversal"`). If the root/path guard ever regressed, `optimizeService` could still probe the outside file; Sharp decode of a text file would fail and the command would return `filesystem_error` / exit 5 with no output and an unchanged sentinel — the test would falsely pass. The sentinel is now a real decodable JPEG (sharp-generated, 64x64), so a regressed guard lets probe succeed and the command proceeds to produce (or fail with a decode/write error whose message does NOT contain the guard signature). The assertion now matches the guard's `escapes (project )?root` message signature via regex, proving the failure is the root/path guard and not a decode fallback. The byte-for-byte sentinel-unchanged check is retained (now via `Buffer.compare`).

## PR4 Review-Fix Batch (applied on `feat/pr4-verification`)

The following confirmed PR4 review blockers/warnings were applied without expanding into Phase 4 archive scope or broad production refactors:

- **CLI e2e hermetic and deterministic**: `test/e2e/cli-flow.test.ts` `runImg` now isolates config on ALL platforms — it forces `APPDATA`, `XDG_CONFIG_HOME`, and `HOME` to a throwaway temp dir (overridable per-call) so the CLI never reads the real developer's user config on Windows or POSIX. The original env is captured and restored in a `finally` so a thrown assertion cannot leak real-config reads into later tests. A docstring documents that the in-process `process.stdout.write`/`process.exitCode`/env monkey-patching MUST run serialized (the describe block is not split across files and every `it` awaits completion) and prescribes a child-process spawn replacement if the file is ever parallelized.
- **ExifTool singleton teardown**: `test/integration/optimization-flow.test.ts` now calls `exiftool.end()` in an `afterAll` so the real `exiftool-vendored` singleton (used by `optimizeService` -> `new ExiftoolMetadata()` and the direct `exiftool` import for tag writes) does not leave a zombie native process keeping the test runner alive after the suite finishes.
- **Strengthened Phase 4 behavior assertions**:
  - Analyze integration (`test/integration/analyze-index-flow.test.ts`) now verifies queryable SQLite index rows (content + occurrence) after a non-dry-run analyze, not only sidecars/cache — proving analyze upserts the index so subsequent reads are queryable without a rebuild.
  - E2E list/stats assertions (`test/e2e/cli-flow.test.ts`) now inspect parsed JSON structure/counts (image count, sha, `used` array slot+location pairs, stats totals), not `JSON.stringify(...).contains(...)` string substrings.
  - Path traversal e2e test now creates an actual outside-root file with a sentinel before the traversal attempt and proves the guard rejects BEFORE any write — the outside file's bytes are unchanged and no sibling output appears.
  - Rotated capture test (`test/integration/optimization-flow.test.ts`) now verifies the rotation was actually applied (output dimensions differ from a non-rotated control), not only that the orientation tag is missing. The `writeTags` helper now uses ExifTool's `-n` flag so numeric `Orientation: 6` is written as a raw int instead of being rejected with "not in PrintConv" (which previously made the test vacuous — sharp never saw the orientation and `.rotate()` was a no-op).
- **Focused regression tests for production fixes**:
  - `stats --json` Commander action signature: added a dedicated e2e test proving `--json` produces parseable JSON with the stats command/ok contract, locking the three-argument `(root, _options, command)` signature so a regression to the two-argument form (which silently swallows `--json`) is caught.
  - Sharp `heif` -> `avif` metadata normalization: added a deterministic unit test in `test/adapters/sharp-processor.test.ts` that creates a real AVIF, confirms sharp reports `format: "heif"`, and asserts `SharpProcessor.probe` normalizes it to `"avif"`.
  - ExifTool non-writable read tags filtered before reapply: added a unit test in `test/adapters/exiftool-metadata.test.ts` that injects a recording seam and asserts all read-only/system tags (`Directory`, `FileName`, `FileSize`, `FileType`, `MIMEType`, `ImageWidth`, `ImageHeight`, `ExifToolVersion`, …) are filtered out before the write seam is called, while writable tags (`ImageDescription`) survive.
- **Readability/fixture cleanup**: Named the dimension constants in `test/domain/path-resize-slug.test.ts` (`sourceWidth`, `sourceHeight`, `requestedWidth`, `maxWidth`, `expectedHeight`) so the resize-planner assertions are self-documenting. Extracted a shared `rmWithRetry` cleanup helper into `test/support/cleanup.ts` and adopted it in `test/e2e/cli-flow.test.ts`, `test/integration/optimization-flow.test.ts`, `test/integration/analyze-index-flow.test.ts`, and `test/app/analyze-service.test.ts`.
- **Windows cleanup retry / line endings**: The shared `rmWithRetry` helper now retries on `EBUSY`, `EPERM`, and `ENOTEMPTY` (not only `EBUSY`), covering the transient lock/permission errors Windows surfaces on freshly written files. `.prettierrc endOfLine: auto` is intentionally kept: the repo has `core.autocrlf=true` on Windows, and a repo-level `.gitattributes` (`* text=auto eol=lf`) would cause repo-wide line-ending churn that violates the focused-fix constraint. `auto` lets Prettier preserve the existing line endings per platform without fighting Git's autocrlf, so `npm run format` passes on both Windows and POSIX without mass reformatting.

## Notes (PR4 review-fix additions)

- **SlotMatcher coverage**: The lexicographic scoring contract (tier selection, extreme-dimension guards, reuse-vs-deficit ordering, deterministic tie-breaks) is covered by the existing `test/domain/slot-matcher.test.ts`. The Phase 4 e2e/integration tests exercise `pickService` end-to-end (which calls `matchSlot`) but do NOT duplicate the SlotMatcher unit-level invariants; those live exclusively in `test/domain/slot-matcher.test.ts`.
- **ExifTool orientation write caveat**: ExifTool's `write` rejects numeric `Orientation` values without the `-n` flag ("Can't convert IFD0:Orientation (not in PrintConv)"). The optimization test's `writeTags` helper now passes `-n` so the orientation is stored as a raw int; without it the tag is silently not written and any rotation-assertion test becomes vacuous.

## PR4 Verification Batch (applied on `feat/pr4-verification`)

The following Phase 4 verification work was completed without reworking Phase 1-3 implementation beyond blockers exposed by the new tests:

- **Domain verification**: Added `test/domain/path-resize-slug.test.ts` covering path traversal rejection, generated-dir segment predicates (including `_out` vs `_outdoor`), configured output-dir exclusions, explicit no-upscale planning, downscale-within-bounds planning, and safe generated filename/collision behavior.
- **Analyze/index integration verification**: Added `test/integration/analyze-index-flow.test.ts` covering recursive discovery through nested folders, unsupported-file ignores, generated output exclusion, duplicate AI-call collapse, sidecar persistence, second-run cache reuse, and database rebuild after deleting `index.sqlite`.
- **Optimization integration verification**: Added `test/integration/optimization-flow.test.ts` covering AVIF output, source preservation, default metadata/GPS stripping, explicit metadata opt-in, orientation-tag normalization, target-exceeds-source failure before writes, and downscale output dimensions.
- **CLI e2e verification**: Added `test/e2e/cli-flow.test.ts` covering JSON stdout shape, pick/mark-used/list/stats contracts, no-match exit 2, invalid input exit 3, optimize path-guard exit 5 with no escape write, analyze dry-run no-write behavior when provider config is missing, project-config secret rejection, and doctor redaction.
- **Phase 4 blocker fixes**: Fixed `stats` command's no-option Commander action signature so CLI `stats` can access global options; normalized Sharp's AVIF metadata report (`heif`) back to the requested `avif` manifest format; filtered ExifTool read-only/system tags before metadata reapply so `--keep-metadata` preserves writable metadata without attempting to write `FileName`/`Directory` back into optimized outputs; set Prettier `endOfLine: auto` so repository CRLF/LF differences do not fail `npm run format` on Windows.

## PR3 Risk-Fix Batch 3 (applied on `feat/pr3-application-services`)

The following confirmed PR3 risk findings were applied without expanding into Phase 4 broad e2e scope:

- **Encoded URL secret parameter names redacted/rejected**: `SecretRedactor.mask()` now scans query/fragment params with a dedicated `URL_ENCODED_PARAM` regex and redacts any whose (possibly percent-encoded) name decodes to a known secret-bearing name (`client%5Fsecret`, `refresh%2Dtoken`, `api%2Dkey`, `access%5Ftoken`, `id%2Dtoken`, etc.) via a new `isEncodedSecretParamName` helper that decodes with `decodeURIComponent` (safely wrapped) and tests the decoded name against the secret param-name regex. `assertProjectConfigHasNoSecrets` likewise gains `hasEncodedSecretUrlParam`, which scans the string for `[?#&]name=…` pairs and rejects any whose decoded name matches a known secret name. Added redactor tests for encoded query and fragment params (`client%5Fsecret`, `refresh%2Dtoken`, `api%2Dkey`, `access%5Ftoken`, `id%2Dtoken`) and a non-secret encoded-param non-redaction test; added project-config rejection tests for encoded query and fragment params plus a non-rejection test for non-secret encoded params.
- **Any URL userinfo treated as secret-bearing**: `SecretRedactor.mask()` now redacts any URL userinfo (not only the `user:pass@` colon form) via a new `URL_USERINFO` regex matching `scheme://` + userinfo + `@`, so `https://token@host.com` and `https://:pass@host.com` are masked alongside the existing `user:pass@` case. `assertProjectConfigHasNoSecrets` URL-credential pattern was broadened from `://[^/s/@]*:[^/s/@]*@` (requiring the colon) to `://[^/s/?#]+@` (any userinfo), so endpoint URLs containing any username or password are rejected. Added redactor tests for `token@host`, `:pass@host`, and `user:pass@host`; added project-config rejection tests for `token@host` and `:pass@host`.

## PR3 Final-Fix Batch (applied on `feat/pr3-application-services`)

The following confirmed review blockers/warnings were applied without expanding into Phase 4 broad e2e scope:

- **Transactional pick usage after post-journal SQL failure**: `appendUsage()` now captures the journal file size before appending and truncates the journal back to its pre-append size when `index.recordUsageEvent()` throws AFTER the journal line was durably written, so a post-journal/SQL failure cannot leave durable usage marking for a rolled-back output. `pickService` accepts an optional `PickDeps.index` injection for test seam. Removed dead `usageRecorded`/`void usageRecorded`. Added a test injecting a failing `SqliteIndex` subclass whose `recordUsageEvent` throws after the journal write, verifying journal truncation and output rollback.
- **Analyze traversal continues past one bad entry**: `walkImages()` now wraps per-directory `fs.readdir` and per-entry stat/guard calls in try/catch so a bad symlink, unreadable subdir, or broken entry becomes a skipped entry and traversal continues to remaining valid files. Root-level readdir failure still propagates so the caller surfaces one skipped entry and filesystem/partial exit. Added a test with a broken symlink followed by a valid image proving the valid image is still processed.
- **Invalid enum/filter CLI validation**: `list`, `pick`, and `optimize` commands now validate orientation and format enum options against fixed valid sets BEFORE service calls, returning structured `invalid_input` exit 3 for malformed values. Exported `validateListEnumOption`, `validatePickEnumOption`, and `validateOptimizeFormatOption` for focused unit tests. Added tests for invalid/valid/undefined/boolean enum inputs.
- **User config API key masking by key context**: `configService` `get`/`set` now use `maskByContext()` which checks the final dotted-key segment against secret-named patterns (`apiKey`, `token`, `secret`, `password`, `credential`, `authorization`, `bearer`) and redacts to `"[REDACTED]"` even when the stored value is short/non-token-shaped. Added `userConfigPath` option to `configService` for test injection. Added tests proving short API keys are masked on both `get` and `list`.
- **Removed committed provider-shaped token literals from tests**: Replaced `sk-proj-...`, `or-v1-...`, and `sk_test_...` literal strings in test source with dynamically-assembled fixtures (joined from non-token-shaped parts) so no single committed string looks like a real provider token while preserving redaction coverage.
- **Readability warnings fixed**: Removed dead `usageRecorded`/`void usageRecorded` in `pick-service.ts`; fixed the sha256 project-config test to actually pass the hash through `parseProjectConfig({ provider: { model: hash } })` instead of a false `void hash` claim; replaced `JSON.stringify(skipped).includes("ProviderError")` with structural `item.error.type` endsWith checking in `analyze-service.ts`; ensured `test/adapters/secret-redactor.test.ts` has a trailing newline.

## PR3 Application-Service Batch (applied on `feat/pr3-application-services`)

The following Phase 3 work was implemented without expanding into the Phase 4 broad e2e suite:

- **Analyze orchestration**: Added `src/app/analyze-service.ts` with root-confined recursive discovery that excludes generated dirs, validates symlink/junction targets, hashes content, dedupes provider calls by sha, reuses sidecar cache hits, keeps dry-run write-free, and organizes duplicate occurrences into unique category/slug destinations.
- **Optimize orchestration**: Added `src/app/optimize-service.ts` using `PathGuard`/`StorageRootGuard` input confinement, `SharpProcessor.probe`, `ResizePlanner.plan`, explicit no-upscale failure, `_out/` output allocation, strip-by-default behavior, and opt-in metadata preservation via `ExiftoolMetadata.reapplyTags`.
- **Pick orchestration**: Added `src/app/pick-service.ts` with mandatory `SqliteIndex.rebuildStatus()` gating through `ensureIndexReady`, `SlotMatcher` alternatives, no-upscale planning, `_out/` asset production, durable usage journal append before success, SQLite usage update, and rollback of produced output when usage recording fails.
- **Library/config/runtime commands**: Added `src/app/library-service.ts`, `src/app/config-service.ts`, `src/app/doctor-service.ts`, and `src/app/runtime.ts`; wired all Phase 3 command handlers to real services. `mark-used --path` validates the path inside root before stat/index lookup and maps missing/orphaned paths to `not_found`/exit 3.
- **Focused PR3 tests**: Added `test/app/analyze-service.test.ts` and `test/app/optimize-pick-library.test.ts` covering dry-run no writes, sha dedupe, duplicate occurrence destinations, optimize no-upscale, pick no-candidate alternatives, pick usage durability, mark-used path safety, and index rebuild gating for list reads.

## PR2 Review-Fix Batch (applied on `pr2/storage-adapters`)

The following review-driven fixes were applied to the PR2 adapter slice without expanding into Phase 3 scope:

- **Path-safety blockers**: Added `StorageRootGuard` (`src/adapters/storage-root-guard.ts`) validating that `.img-ia`, sidecar, SQLite, journal, and cache paths stay inside `--root` and refuse symlink/junction/reparse escapes. Occurrence paths in `rebuildFromSidecars` are validated with `assertOccurrenceInsideRoot` before join/hash — escaped/absolute occurrences are quarantined as audit entries and never read.
- **Sharp output safety**: `SharpProcessor.produce` uses exclusive finalization (`rejectExistingTarget`) so a pre-existing caller target is never silently overwritten. Decode failures surface as `DecodeError`; write failures as `WriteError`.
- **ExifTool privacy**: `stripAll` uses `exiftool.write` with `-overwrite_original_in_place` and a `finally` block that always removes any `_original` backup, even on failure.
- **Honest Windows durability**: `fsyncDirectoryHonest` and `fsyncFile` surface EPERM/ENOTSUP/EINVAL as degraded-durability states on Windows instead of silently claiming full durability or aborting successful writes.
- **Atomic SQLite rebuild**: `rebuildFromSidecars` stages all work in memory then commits inside a single transaction with a `rebuild_sentinel` table so interrupted rebuilds cannot leave a silently valid partial index. `rebuildStatus()` exposes the sentinel state.
- **Usage journal validation**: `parseUsageEvent` validates sha256 format, non-empty slot/location, valid source, and parseable timestamp; invalid/torn lines become warnings and do not seed `slot_use`.
- **OpenAI-compat typed errors**: `RefusalProviderError` is no longer swallowed by the catch block and re-thrown as `MalformedOutputProviderError`; all four typed errors now propagate correctly. Tests cover 429→RateLimit, abort→Timeout, refusal→Refusal, non-JSON/schema→MalformedOutput, and API-key non-leak in redacted diagnostics.
- **Test quality**: Added behavior tests for `SharpProcessor` (probe/produce/downscale/overwrite/decode-error), `ExiftoolMetadata` (stripAll cleanup on success+failure via mock seam, reapplyTags no-op, read error wrapping), `StorageRootGuard` (symlink/junction escape, occurrence validation), and `OpenAICompatVisionProvider` (typed errors + redaction).
- **Config cleanup**: Removed `--passWithNoTests` from `package.json` and `passWithNoTests: true` from `vitest.config.ts` now that 73 tests exist.

## PR2 Review-Fix Batch 2 (applied on `pr2/storage-adapters`)

The following remaining PR2 blockers were applied without expanding into Phase 3 scope:

- **Symlink/junction occurrence escape**: `rebuildFromSidecars` now resolves/lstat/realpaths every lexically-valid occurrence path via `StorageRootGuard.ensureInside(path, mustExist=true)` before hashing/reading. An occurrence that is lexically inside root but points outside via a symlink, Windows junction, or reparse point is quarantined as an audit entry and never read. Added a test with an in-root symlink pointing outside root (platform-conditional skip when the OS denies creating the link).
- **Usage journal path confinement**: `replayUsageJournal` and `rebuildFromSidecars({ usageJournalPath })` now validate the journal path through `StorageRootGuard.ensureInsideSync` before reading. An arbitrary outside-root journal path is rejected with `StorageRootGuardError` and no file is read. Added tests proving an outside-root journal is rejected for both `replayUsageJournal` and `rebuildFromSidecars`.
- **ExifTool timeout**: Added a configurable per-operation deadline (`ExiftoolMetadataOptions.timeoutMs`, default 30s) wrapping every ExifTool seam operation (`read`, `stripAll`, `reapplyTags`). On timeout the operation rejects with a typed `MetadataError` instead of hanging forever. Added tests with a never-resolving seam proving the timeout behavior for all three operations.
- **Vitest focused-test protection**: Set `test.allowOnly: false` in `vitest.config.ts` so `test.only`/`describe.only` fail the suite; `passWithNoTests` remains removed.
- **apply-progress test count**: Removed the inaccurate test-count split; the PR2 total at that point was stated as a single historical count (10 files / 87 tests). Later PR3 batches record the current live suite counts as coverage is added.

## PR2 Review-Fix Batch 3 (applied on `pr2/storage-adapters`)

The following user-approved warning fixes were applied without expanding into Phase 3 scope:

- **SharpProcessor output root confinement**: `SharpProcessor` now accepts an optional `StorageRootGuard` in its constructor. When provided, `produce` validates the output path and its parent chain stay inside the project root before any file is written, and rejects symlink/junction escapes that would redirect the output outside root. When omitted, root confinement remains the caller's responsibility (documented precondition). Added tests proving an outside-root output path and an in-root output symlink pointing outside are both rejected with `StorageRootGuardError` and nothing is written outside root.
- **SharpProcessor atomic no-overwrite finalization**: Replaced the `rejectExistingTarget` (stat) + `fs.rename` pair — which had a TOCTOU window where a foreign writer could create the target between stat and rename and be silently clobbered — with `fs.link(temp, output)` which is atomic and fails with `EEXIST` on collision, then unlinks the temp. Falls back to the stat-then-rename path only when `link` is unavailable (cross-device/ENOSYS), documented as a platform limitation. Added a test proving no leftover temp file pollutes the output directory when finalization refuses to overwrite.
- **Secret-shaped test fixtures removed**: Replaced committed provider-shaped literals (`sk-test_...`, `or-secret_...`) in `test/adapters/openai-compat.test.ts` and the renamed `test/adapters/secret-redactor.test.ts` with dynamically-assembled fixtures (`buildPrefixedSecret(prefix, label, tail)`) so no single committed string is provider-shaped, avoiding secret-scanner false positives while preserving redaction behavior coverage (the redactor's prefix+length regex still matches the assembled values).
- **Windows junction/directory-symlink rebuild test**: Added a deterministic Windows-safe test in `test/adapters/sqlite-index.test.ts` using a directory junction (`organized/escape-dir -> outsideDir`, occurrence `organized/escape-dir/stolen.jpg`). Proves the rebuild quarantines the junction-escaping occurrence BEFORE hashing and does not select the outside file. Skips only when the OS denies link creation.
- **fsync degraded branch tests**: Added tests in `test/adapters/storage-root-guard.test.ts` for `fsyncDirectoryHonest`: (1) the unsupported-directory-fsync branch does not throw and returns `unsupported: true` on Windows; (2) a genuine fsync failure (EIO) propagates as a thrown error instead of being silently swallowed. Added a small module-level test seam (`__setDirectoryFsyncForTest`) to inject the failure rather than relying on brittle OS behavior.
- **vision-redactor.test.ts renamed**: Renamed `test/adapters/vision-redactor.test.ts` to `test/adapters/secret-redactor.test.ts` to match the production class name (`SecretRedactor`); only paths/names changed, no behavior change.
- **Phase 3 rebuildStatus obligation documented**: Added a mandatory note in `## Notes` that every Phase 3 application service reading the index (query/stats/pick/mark-used/list) MUST call `SqliteIndex.rebuildStatus()` before trusting results and trigger a rebuild when the status is `in_progress` or `null`. This documents the runtime enforcement of the atomic-rebuild invariant for the Phase 3 slice without implementing it here.

## PR3 Review-Fix Batch (applied on `feat/pr3-application-services`)

The following user-approved review blockers were applied without expanding into Phase 4 broad e2e scope:

- **Pick input root guard**: `pickService` now validates the index-derived `canonicalRelPath` through `StorageRootGuard.ensureInside(source, true)` (realpath + containment) and `fs.stat` BEFORE `SharpProcessor.produce`. Missing files and symlink/junction escapes are rejected with a typed `no_candidate` safe error (exit 2), not a generic filesystem error. Added tests for missing-file and symlink-escape cases.
- **Project config read root guard**: `readProjectConfig()` now validates `<root>/.img-ia/config.json` through `StorageRootGuard` before reading, preventing a pre-existing `.img-ia` symlink/junction from redirecting config reads outside root. Added a test with an in-root `.img-ia` symlink pointing outside root (platform-conditional skip when the OS denies link creation).
- **Central redaction for command/service errors**: All command catch blocks (analyze, config, stats, mark-used, pick, optimize, list) now use the `serviceError` helper which routes through `SecretRedactor.mask`. `analyzeService` skipped entries use `redactErrorMessage` instead of raw `error.message`. Added tests proving a secret-shaped error is redacted in `serviceError`, `redactErrorMessage`, and `SecretRedactor.mask`.
- **Prototype pollution in config dotted keys**: `configService` `setPath`/`getPath` now reject `__proto__`, `constructor`, `prototype`, and empty segments via `assertSafeDottedKey` throwing a typed `ConfigKeyError`. `configService` catches `ConfigKeyError` and returns `invalid_input` exit 3. Added tests for all forbidden segments and empty keys.
- **Analyze walk error contract**: Errors from `walkImages(root)` / `fs.readdir` / `StorageRootGuard` during traversal are now caught and converted into a batch-shaped skipped entry with filesystem exit 5, not a global `invalid_input` exit 3. Dry-run no-write contract is preserved. Added tests for nonexistent-root (walk-level error → exit 5) and secret-redaction in skipped entries.
- **Pick usage/output transaction contract**: `pickService` no longer throws on usage failure; instead it rolls back the produced `_out` asset and returns a structured `usage_failed` result (exit 5) with an actionable reason and redacted error detail, so no durable usage journal entry survives a failed pick. Added a test using a directory-blocking journal to verify rollback and `usage_failed` exit 5.
- **Numeric flag validation**: `optimize`, `pick`, and `list` commands now validate integer flags (reject NaN, non-integer, negative, and non-numeric values) with structured `invalid_input` exit 3 BEFORE service calls. Tests cover the validation path indirectly via the command registration functions.
- **Missing behavior tests for Phase 3 outward contracts**: Added `test/app/config-doctor-library.test.ts` covering `configService` (list/get/set, prototype pollution rejection, root-guard symlink rejection), `doctorService` (healthy checks, exiftool readiness failure, provider-ping seam), `statsService` (indexed root counts), and `listService` (indexed root images).
- **Doctor runtime checks**: `doctorService` now includes an ExifTool readiness check (via `exiftoolProbe` seam; production uses the real singleton) and a provider reachability/ping seam (`pingProvider`). Live network ping is deferred to a later slice (documented); the seam is tested with injected stubs for both success and failure paths.
- **Staged-write recovery journal spec deviation**: Full `.img-ia/.journal` replay is deferred to a later slice. Documented in `## Notes` that the current crash-safe ordering (sidecar temp+fsync+rename BEFORE move; SQLite index as rebuildable derived view) plus `rebuildStatus`/`rebuildFromSidecars` reconciliation satisfies the recoverable-state invariant as interim behavior. The deferred journal would additionally roll back orphaned temp files and log the interrupted opId.

## PR3 Re-Review-Fix Batch (applied on `feat/pr3-application-services`)

The following remaining re-review blockers were applied without expanding into Phase 4 broad e2e scope:

- **Project config secret-shaped value rejection**: `assertProjectConfigHasNoSecrets` now inspects primitive string values (not just key names) and rejects URL embedded credentials (`user:pass@host`), query-param tokens (`?api_key=…`, `&token=…`), Bearer header values, known provider-prefixed tokens (`sk-`, `or-`, `AIza`, `gsk_`, `ollama_`), and long high-entropy blobs (40+ chars), while exempting plain sha256 hashes. Project config `list`/`get`/`set` output is now routed through `defaultSecretRedactor.maskValue` as defense-in-depth. `configService` `set` now surfaces secret-rejection and Zod validation errors as structured `invalid_input` exit 3 (via broadened `invalidKey`) instead of crashing. Added tests for URL credentials, query-param tokens, Bearer values, `sk-proj-…` tokens, high-entropy blobs, sha256 exemption, and nested-array rejection.
- **SecretRedactor known-prefix hyphenated tokens**: Removed the `^[a-z0-9]+(?:-[a-z0-9]+)+$` branch from `looksLikePlainIdentifier` (it rescued provider-prefixed hyphenated tokens like `sk-proj-abcdef…`). Added `hasKnownSecretPrefix` so any `LONG_SECRET_VALUE` match starting with a known provider prefix is always redacted. Added tests for `sk-proj-…` and `or-v1-…` redaction and sha256 non-redaction.
- **Blank numeric CLI inputs**: `optimize`, `pick`, and `list` `validateIntOption` now reject `""` and whitespace-only values with structured `invalid_input` exit 3 instead of treating them as "no value provided". Exported `validateOptimizeIntOption`/`validatePickIntOption`/`validateListIntOption` for focused unit tests. Added `test/commands/numeric-validation.test.ts` covering blank, whitespace, non-integer, zero, negative, non-numeric, valid, undefined, and boolean inputs.
- **Doctor ExifTool readiness real probe**: `probeExiftool()` now calls `exiftool.version()` (a real native ExifTool spawn + version read) instead of `void exiftool` (a no-op). Tests inject `deps.exiftoolProbe` to avoid spawning the real process.
- **Doctor deferred-ping non-verified contract**: When no `pingProvider` seam is provided, `provider-ping` now reports `ok: false`, `deferred: true` (not `ok: true`), and the overall status is `failed` with reason `doctor_not_verified` and exit 5 — so a deferred ping is never silently indistinguishable from healthy OK. Added `userConfigPath` seam to `DoctorDeps` so doctor tests assert success/failure contracts against controlled user config (written to a temp file) instead of the uncontrolled local developer machine config. Rewrote all doctor tests to use controlled config and assert the new deferred/failed contract.

## PR3 Clean-Gate Fix Batch (applied on `feat/pr3-application-services`)

The following confirmed clean-gate findings were applied without expanding into Phase 4 broad e2e scope:

- **Sidecar directory guard before enumeration**: `listSidecars()` now validates the `.img-ia/sidecars` directory path through `StorageRootGuard` (via a new `SidecarStore.ensureSidecarDirInside()` method) before `fs.readdir`, including symlink/junction/reparse-point realpath semantics. A pre-existing `.img-ia/sidecars` symlink/junction that escapes root is rejected before any outside-root directory enumeration happens, rather than relying solely on per-sidecar guarded reads. ENOENT (missing directory) still maps to an empty list. Added tests for missing sidecar dir (empty) and escaping symlink (rejected with `StorageRootGuardError`).
- **Project config guard honesty for doctor/read callers**: `readProjectConfig()` no longer catches all `guard.ensureInside(configPath, true)` failures as missing config. Only ENOENT (genuinely missing file/broken symlink target) maps to `emptyProjectConfig()`. `StorageRootGuardError` (root-escape/tampered config path) now propagates so `doctorService()` reports `project-config` as `ok: false` instead of silently treating the escaping path as missing. `configService` retains its `.catch(() => emptyProjectConfig())` defense-in-depth for the list/get path (no outside config leaks). Added a doctor test proving an escaping `.img-ia` symlink surfaces `project-config: ok=false`.
- **Bad-entry traversal test exercises the contract**: Fixed `test/app/analyze-service.test.ts` "continues traversal past a bad symlink entry" so it no longer creates `00-bad.jpg` as a real file before symlinking (which caused EEXIST and a silent early return without exercising bad-entry traversal). The test now creates only the symlink to a nonexistent target plus a valid `zz-good.jpg` after it. OS symlink denial (EPERM/EACCES) skips explicitly and honestly with a console warning; other errors propagate. Added assertions that at least one valid image was processed (`planned` contains `zz-good.jpg`) and at least one bad entry was skipped (`skipped.length >= 1`).

## PR3 Final Risk-Fix Batch (applied on `feat/pr3-application-services`)

The following confirmed PR3 risk findings were applied without expanding into Phase 4 broad e2e scope:

- **Config/doctor endpoint URL credential leakage**: `SecretRedactor.mask()` now redacts URL basic-auth credentials (`https://user:pass@host` → `https://[REDACTED]@host`) and short query/fragment tokens (`?api_key=x`, `#token=y` → `[REDACTED]`) so endpoint values never leak through `config list/get` or `doctor` output. `doctorService` now masks the endpoint in all `provider-ping` check details (the live ping still receives the raw endpoint). Added tests for config get/list endpoint redaction and doctor endpoint redaction, plus redactor unit tests for URL credentials, query tokens, and fragment tokens.
- **Project config guard failures hidden by `config --project list/get`**: `configService` no longer catches all `readProjectConfig(root)` failures as `emptyProjectConfig()`. A new `safeReadProjectConfig` helper maps ENOENT (genuinely missing config) to an empty config and surfaces any other failure (StorageRootGuardError/path escape) as a structured `invalid_input` outcome (exit 3) with a redacted message, for project config list/get/set. Updated the symlink-escape config test to assert the new structured-failure contract and added a config get symlink-escape test.

## PR3 Fragment-Token Risk-Fix Batch (applied on `feat/pr3-application-services`)

The following confirmed PR3 risk finding was applied without expanding into Phase 4 broad e2e scope:

- **Project config rejects URL fragment token params; doctor masks project config details defensively**: `assertProjectConfigHasNoSecrets` URL-token regex now uses `[?#&]` (not just `[?&]`) so URL fragment token params (`#token=`, `#access_token=`, `#api_key=`, `#secret=`) are rejected at parse time the same way query-param tokens are — closing a bypass where `https://host.com#token=x` slipped past validation. `doctorService` now routes the `project-config` check `details` through `defaultSecretRedactor.maskValue` as defense-in-depth, so a future validation gap never leaks raw project config secrets through `doctor` output. Added tests proving fragment token endpoints are rejected (`#token=`, `#access_token=`, `#api_key=`, `#secret=`) and that doctor does not print raw fragment tokens (validation rejects the config so the check fails with no token leak), plus a test asserting doctor project-config details are masked.

## PR3 Final Risk-Fix Batch 2 (applied on `feat/pr3-application-services`)

The following confirmed PR3 risk findings were applied without expanding into Phase 4 broad e2e scope:

- **Broadened URL credential parameter validation/redaction**: `assertProjectConfigHasNoSecrets` URL-token regex and `SecretRedactor` URL query/fragment token regex now cover common secret-bearing parameter names beyond `api_key`/`token`/`secret`/`access_token`: `refresh_token`, `id_token`, `client_secret`, `private_key`, `auth_token`, `bearer_token`, `password`/`passwd`/`pwd`, `credential`, and bare `key`, with hyphen/underscore/case-insensitive variants via `[_-]?` optional separators and the `i` flag. The project-config secret key-name pattern was likewise broadened to reject `refresh_token`, `id_token`, `client_secret`, `private_key`, `auth_token`, `bearer_token`, `passwd`/`pwd` object keys. Applied consistently to both query and fragment params in validation and redaction. Added focused tests for project-config rejection (`?refresh_token=`, `#id_token=`, `?client_secret=`, `?key=`, hyphenated/upper-case variants, `refresh_token`/`client_secret` key names) and redactor coverage (`?refresh_token=`, `#id_token=`, `?client_secret=`, `?key=`, `API-KEY`/`Refresh-Token` variants, `refresh_token`/`client_secret` object keys), plus a doctor test proving `refresh_token`/`id_token`/`client_secret` endpoint params are masked in doctor output.
- **Validate existing parent chain when final config path is missing**: `StorageRootGuard.realpathInside()` no longer returns the unresolved absolute path on a final-path ENOENT without checking the existing parent chain. It now calls `realpathOfNearestExistingAncestor` and asserts containment, so an escaping `.img-ia` symlink/junction whose target lacks `config.json` throws `StorageRootGuardError` (surfaced as a structured `invalid_input` failure / doctor `project-config: ok=false`) instead of being silently treated as a missing config. A genuinely missing config inside an in-root root remains an empty config. Added a config test proving an escaping `.img-ia` symlink with no `config.json` surfaces as exit 3 `invalid_input`, a doctor test proving the same scenario reports `project-config: ok=false`, and a doctor test proving a root with no `.img-ia` at all remains `project-config: ok=true` (no over-trigger). Adjusted the existing nonexistent-root analyze test to accept either `Error` or `StorageRootGuardError` as the walk-level skipped-entry error type, since the parent-chain validation now surfaces a guard error for a nonexistent root before `fs.readdir` is reached — both are walk-level failures producing exit 5, and the exact error type is an implementation detail.

## Notes

- Command handlers intentionally return structured `not_implemented` placeholder results until Phase 3 application services exist.
- **Phase 3 rebuildStatus obligation (MANDATORY)**: every Phase 3 application service that reads the index (query, stats, pick, mark-used, list) MUST call `SqliteIndex.rebuildStatus()` before trusting any query/stats/pick result. `rebuildStatus()` returns `"completed"` when the last rebuild finished atomically and the derived tables are consistent, `"in_progress"` when a rebuild was interrupted (the sentinel survived an abort/crash), or `null` when no rebuild has ever run. When the status is `"in_progress"` or `null`, the service MUST trigger a `rebuildFromSidecars(...)` before serving reads; it MUST NOT silently return partial/stale results. This obligation is the runtime enforcement of the atomic-rebuild invariant and is required even though it is implemented in Phase 3, not in this PR2 adapter slice.
- `format` is scoped to Phase 1 source/config files so existing OpenSpec markdown is not reformatted as part of this work unit.
- Build output under `dist/` was generated by `npm run build` and is ignored; source of truth remains `src/`.
- SQLite remains a rebuildable view: rebuild consumes sidecars plus `usage.jsonl`, excludes missing or sha-mismatched occurrences from selectable query results, and keeps stale paths as audit data.
- Thumbnails remain out of durable truth for this PR2 slice; `SqliteIndex.stats()` accepts sidecar/thumbnail counts from the future app-service layer rather than scanning cache directories itself.
- OpenAI-compatible provider requests assume images have already been downscaled by `SharpProcessor.downscaleForVision()` before `VisionProvider.analyze()` is called; Phase 3 orchestration will enforce that call order.
- `ExiftoolMetadata` accepts an optional `ExiftoolSeam` in its constructor for test injection; production code passes no seam and uses the real `exiftool` singleton.
- **Staged-write recovery journal spec deviation (DEFERRED)**: The design specifies a per-operation recovery journal at `.img-ia/.journal/<opId>.jsonl` with `BEGIN`/`END` records enabling replay/reconciliation of interrupted operations on next launch (see design.md "Staged Writes & Recovery"). This PR3 slice does NOT implement the `.img-ia/.journal/` recovery journal. The interim crash-safe behavior relies on the existing ordered writes (sidecar temp+fsync+rename BEFORE move; SQLite index is a derived view rebuilt from sidecars + source scan) plus `SqliteIndex.rebuildStatus()`/`rebuildFromSidecars()` reconciliation. A sidecar without a live occurrence is reconciled on the next rebuild (re-derived from source scan or excluded as audit data); an occurrence without a committed sidecar is excluded/quarantined during rebuild. Full `.img-ia/.journal` replay (BEGIN-without-END detection, staged-but-not-committed temp rollback) is deferred to a later slice. The current ordering ensures the durable truth (sidecars + `usage.jsonl`) is always committed before derived state (SQLite index), so an interruption leaves at most a derived index that rebuild reconciles — never a silently half-applied durable mutation. The deferred journal would additionally roll back orphaned temp files and log the interrupted opId, but the recoverable-state invariant is already satisfied by the rebuild path.
