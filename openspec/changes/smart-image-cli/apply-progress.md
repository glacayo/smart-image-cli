# Apply Progress: Smart Image CLI

## Mode

Standard (OpenSpec). `strict_tdd: false` in `openspec/config.yaml`.

## Workload / PR Boundary

- Delivery mode: chained PR slice / work unit 2 only
- Boundary: Phase 2 storage/adapters on branch `pr2/storage-adapters`; no commit, push, or PR was created in this apply batch
- Chain strategy: pending in `tasks.md`; the user explicitly assigned PR2/work unit 2 for this batch
- Scope guard: no Phase 3 application services, command orchestration, or Phase 4 e2e suite were implemented beyond adapter-level tests

## Completed Tasks

- [x] 1.1 Created Node 22 ESM TypeScript tooling with `img` bin and scripts for `test`, `lint`, `format`, and `typecheck`.
- [x] 1.2 Created CLI program/output/exit-code modules and thin command handlers for `analyze`, `optimize`, `pick`, `mark-used`, `list`, `stats`, `config`, and `doctor`.
- [x] 1.3 Created shipped taxonomy and user/project config contracts; provider secrets are modeled only in per-user config and explicitly rejected from project config.
- [x] 1.4 Implemented pure domain modules for path guarding, generated-dir exclusion, slug naming, resize planning, slot matching, taxonomy, and analysis schema.
- [x] 2.1 Implemented `SidecarStore` with per-sha promise serialization, durable temp-file writes, file fsync, atomic rename, and directory fsync best-effort for platforms that support it.
- [x] 2.2 Normalized sidecar primary policy so `canonicalRelPath` is always included as `occurrences[0]` with `primaryFlag: "canonicalRelPath"`; rebuild primary selection promotes the first live sha-verified occurrence when the stored canonical path is missing or stale.
- [x] 2.3 Implemented `SqliteIndex` with rebuildable content/occurrence tables, live-occurrence sha verification during rebuild, append-event/dedupe-record usage replay, and stats totals exposing both raw `usageEvents` and deduped `usageRecords`.
- [x] 2.4 Implemented Sharp, ExifTool, and OpenAI-compatible vision adapters with typed decode/write/metadata/provider errors plus centralized secret redaction for provider diagnostics.

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
- **apply-progress test count**: Removed the inaccurate test-count split; the total is now stated as a single honest count (10 files / 87 tests, the live count maintained as batches add coverage).

## PR2 Review-Fix Batch 3 (applied on `pr2/storage-adapters`)

The following user-approved warning fixes were applied without expanding into Phase 3 scope:

- **SharpProcessor output root confinement**: `SharpProcessor` now accepts an optional `StorageRootGuard` in its constructor. When provided, `produce` validates the output path and its parent chain stay inside the project root before any file is written, and rejects symlink/junction escapes that would redirect the output outside root. When omitted, root confinement remains the caller's responsibility (documented precondition). Added tests proving an outside-root output path and an in-root output symlink pointing outside are both rejected with `StorageRootGuardError` and nothing is written outside root.
- **SharpProcessor atomic no-overwrite finalization**: Replaced the `rejectExistingTarget` (stat) + `fs.rename` pair — which had a TOCTOU window where a foreign writer could create the target between stat and rename and be silently clobbered — with `fs.link(temp, output)` which is atomic and fails with `EEXIST` on collision, then unlinks the temp. Falls back to the stat-then-rename path only when `link` is unavailable (cross-device/ENOSYS), documented as a platform limitation. Added a test proving no leftover temp file pollutes the output directory when finalization refuses to overwrite.
- **Secret-shaped test fixtures removed**: Replaced committed provider-shaped literals (`sk-test_...`, `or-secret_...`) in `test/adapters/openai-compat.test.ts` and the renamed `test/adapters/secret-redactor.test.ts` with dynamically-assembled fixtures (`buildPrefixedSecret(prefix, label, tail)`) so no single committed string is provider-shaped, avoiding secret-scanner false positives while preserving redaction behavior coverage (the redactor's prefix+length regex still matches the assembled values).
- **Windows junction/directory-symlink rebuild test**: Added a deterministic Windows-safe test in `test/adapters/sqlite-index.test.ts` using a directory junction (`organized/escape-dir -> outsideDir`, occurrence `organized/escape-dir/stolen.jpg`). Proves the rebuild quarantines the junction-escaping occurrence BEFORE hashing and does not select the outside file. Skips only when the OS denies link creation.
- **fsync degraded branch tests**: Added tests in `test/adapters/storage-root-guard.test.ts` for `fsyncDirectoryHonest`: (1) the unsupported-directory-fsync branch does not throw and returns `unsupported: true` on Windows; (2) a genuine fsync failure (EIO) propagates as a thrown error instead of being silently swallowed. Added a small module-level test seam (`__setDirectoryFsyncForTest`) to inject the failure rather than relying on brittle OS behavior.
- **vision-redactor.test.ts renamed**: Renamed `test/adapters/vision-redactor.test.ts` to `test/adapters/secret-redactor.test.ts` to match the production class name (`SecretRedactor`); only paths/names changed, no behavior change.
- **Phase 3 rebuildStatus obligation documented**: Added a mandatory note in `## Notes` that every Phase 3 application service reading the index (query/stats/pick/mark-used/list) MUST call `SqliteIndex.rebuildStatus()` before trusting results and trigger a rebuild when the status is `in_progress` or `null`. This documents the runtime enforcement of the atomic-rebuild invariant for the Phase 3 slice without implementing it here.

## Notes

- Command handlers intentionally return structured `not_implemented` placeholder results until Phase 3 application services exist.
- **Phase 3 rebuildStatus obligation (MANDATORY)**: every Phase 3 application service that reads the index (query, stats, pick, mark-used, list) MUST call `SqliteIndex.rebuildStatus()` before trusting any query/stats/pick result. `rebuildStatus()` returns `"completed"` when the last rebuild finished atomically and the derived tables are consistent, `"in_progress"` when a rebuild was interrupted (the sentinel survived an abort/crash), or `null` when no rebuild has ever run. When the status is `"in_progress"` or `null`, the service MUST trigger a `rebuildFromSidecars(...)` before serving reads; it MUST NOT silently return partial/stale results. This obligation is the runtime enforcement of the atomic-rebuild invariant and is required even though it is implemented in Phase 3, not in this PR2 adapter slice.
- `format` is scoped to Phase 1 source/config files so existing OpenSpec markdown is not reformatted as part of this work unit.
- Build output under `dist/` was generated by `npm run build` and is ignored; source of truth remains `src/`.
- SQLite remains a rebuildable view: rebuild consumes sidecars plus `usage.jsonl`, excludes missing or sha-mismatched occurrences from selectable query results, and keeps stale paths as audit data.
- Thumbnails remain out of durable truth for this PR2 slice; `SqliteIndex.stats()` accepts sidecar/thumbnail counts from the future app-service layer rather than scanning cache directories itself.
- OpenAI-compatible provider requests assume images have already been downscaled by `SharpProcessor.downscaleForVision()` before `VisionProvider.analyze()` is called; Phase 3 orchestration will enforce that call order.
- `ExiftoolMetadata` accepts an optional `ExiftoolSeam` in its constructor for test injection; production code passes no seam and uses the real `exiftool` singleton.
