# Tasks: Smart Image CLI

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 3,000-5,000 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 foundation -> PR 2 analyze/index/AI -> PR 3 optimize/pick/runtime/tests |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Tooling, CLI shell, pure domain contracts | PR 1 | Base main; unit tests included |
| 2 | Analyze, sidecars, SQLite, AI provider | PR 2 | Depends on PR 1; rebuild tests included |
| 3 | Optimize, pick, usage, doctor, e2e | PR 3 | Depends on PR 2; runtime specs verified |

## Phase 1: Foundation / Tooling

- [x] 1.1 Create `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts` with Node 22 ESM, `img` bin, scripts for `test`, `lint`, `format`, `typecheck`.
- [x] 1.2 Create `src/cli/{program,output,exit-codes}.ts` and `src/commands/{analyze,optimize,pick,mark-used,list,stats,config,doctor}.ts` as thin handlers.
- [x] 1.3 Create `assets/categories.json` and `src/config/{user-config,project-config}.ts`; keep provider keys per-user only.
- [x] 1.4 Implement `src/domain/{path-guard,slug-namer,resize-planner,slot-matcher,taxonomy,analysis-schema}.ts`, including the design's exact generated-dir exclusion predicate.

## Phase 2: Storage / Adapters

- [ ] 2.1 Implement `src/adapters/sidecar-store.ts` with temp+fsync+rename, per-sha lock covering first sidecar creation and every occurrence merge.
- [ ] 2.2 Resolve sidecar primary policy consistently: `canonicalRelPath`, `occurrences[]`, and `primaryFlag` or `occurrences[0]` in write/rebuild paths.
- [ ] 2.3 Implement `src/adapters/sqlite-index.ts` and usage replay so `stats` exposes raw `usageEvents` separately from deduped `usageRecords`.
- [ ] 2.4 Implement `src/adapters/{sharp-processor,exiftool-metadata}.ts` and `src/adapters/vision/{provider,openai-compat,presets}.ts` with typed errors and redaction.

## Phase 3: Application Services

- [ ] 3.1 Implement `src/app/analyze-service.ts`: walk, symlink guard, sha dedupe, dry-run, staged writes, cache hits, and unique occurrence destinations for duplicate files.
- [ ] 3.2 Implement `src/app/optimize-service.ts`: probe, no-upscale planning, crop/resize/convert, metadata stripping, `_out/` staged writes.
- [ ] 3.3 Implement `src/app/pick-service.ts`: constraint matching, alternatives, no-upscale, output manifest, transactional usage recording.
- [ ] 3.4 Implement `mark-used`, `list`, `stats`, `config`, `doctor`; route `mark-used --path` through `PathGuard` before existence lookup.

## Phase 4: Verification

- [ ] 4.1 Add unit tests under `test/domain/` for Path Safety, Generated-Asset Exclusion, No Upscaling, SlotMatcher alternatives, SlugNamer collisions.
- [ ] 4.2 Add integration tests under `test/integration/` for Recursive Discovery, Duplicates Collapsed Before AI, Sidecar Persisted, Second Run Reuses Cache, Database Rebuilt After Loss.
- [ ] 4.3 Add optimization tests for Convert to AVIF, GPS Removed, Metadata Opt-In, Rotated Capture Normalized, Requested Size Exceeds Source, Downscale Within Bounds.
- [ ] 4.4 Add e2e CLI tests under `test/e2e/` for JSON stdout, stable exit codes, pick no-match exit 2, invalid args exit 3, doctor readiness, and secret non-leak.
