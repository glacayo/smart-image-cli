# Tasks: Replace Unsplash with Pixabay

## Review Workload Forecast

Estimated changed lines: WU6c full candidate >400 raw; slices ~379 / ~217 / WU6c3a 295 / WU6c3b 292
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High
Delivery strategy: auto-chain
Suggested split: WU6c1 → WU6c2 → WU6c3a → WU6c3b

WU6c re-sliced under hard 400 raw budget. WU6c3 further split: obsolete test deletion (WU6c3a) then core pick-service teardown + static guard (WU6c3b).

### Maintainer-approved historical `size:exception` (scoped)

Independent verify (`verify-report.md`, evidence `sha256:606301de2c74ab9398ba595545d9c87cbac8a36f76e0497e7d4cbcb5fc0a1ed7`) measured two historical commits above the hard 400 raw budget. Maintainer decision (2026-08-10): approve `size:exception` **only** for these commits — do not rewrite history; do not relax later budgets.

| Work unit | Commit | Claimed raw (superseded) | Actual raw (`git show --numstat`) | Exception scope |
|-----------|--------|--------------------------|-----------------------------------|-----------------|
| WU2 | `157ccdd` | 398 | **430** | Historical commit only |
| WU5b3 | `243774d` | 400 | **433** | Historical commit only |

No other work unit inherits this exception. Later remediation and future slices remain hard-capped at 400 raw unless a new explicit exception is granted.

### Suggested Work Units

Existing WU5b units remain: WU5b1 adapter (~190), WU5b2 candidate seam (~300), WU5b3 transaction/wiring (actual commit `243774d` = 433 raw with scoped `size:exception`); their focused tests, harnesses, and rollback boundaries are unchanged.

## Phase 1: Foundation
- [x] 1.1 WU1: domain bands/rendition ladder and pure tests.
- [x] 1.2 WU2: Pixabay BYOK schema, setup, resolver, guard, and tests. Commit `157ccdd` actual raw **430** — maintainer `size:exception` (historical only; see forecast).

## Phase 2: Provider Adapters
- [x] 2.1 WU3: Pixabay client, rate limits, redacted errors, tests.
- [x] 2.2 WU4: 24h key-free cache, atomic writes, tests.

## Phase 3: Visible Pixabay Behavior
- [x] 3.1 WU5a: explicit source/safesearch/query contract; fail closed until WU5b3.
- [x] 3.2 WU5b1: used-id adapter, malformed-line recovery, containment, `0600`; no pick wiring.
- [x] 3.3 WU5b2: search/cache/filter/rendition/dedupe seam; CLI remains fail closed.
- [x] 3.4 WU5b3: download, Sharp, usage rollback, manifest, and `pick`/CLI wiring. Commit `243774d` actual raw **433** — maintainer `size:exception` (historical only; see forecast).

## Phase 4: Unsplash Removal
- [x] 4.1a WU6a1 (~122): P:WU5b3; decouple `pick-service` from Unsplash HTTP; fail closed; update credential tests.
- [x] 4.1b WU6a2 (~295): P:WU6a1; delete orphaned `unsplash-client` and its test; add static absence guard.

### 4.2 WU6b re-slice

Dependency: WU6a2 `f4e9381` → WU6b1 → WU6b2 → WU6c. Each estimate is raw additions+deletions and is below 400.
Proof(1): `npx vitest run test/app/unsplash-setup-service.test.ts test/app/unsplash-setup-removed.test.ts test/commands/config-unsplash-removed.test.ts test/commands/config-pixabay-setup.test.ts test/app/pixabay-setup-service.test.ts && npm run typecheck`.
Proof(2): `npx vitest run test/app/unsplash-setup-removed.test.ts test/commands/config-unsplash-removed.test.ts test/commands/config-pixabay-setup.test.ts test/app/pixabay-setup-service.test.ts && npm run typecheck`.

- [x] **4.2.1 WU6b1 (~290):** Remove setup import/dispatch in `src/app/config-service.ts` and Unsplash help in `src/commands/config.ts`; replace `test/commands/config-unsplash-setup.test.ts` with `test/commands/config-unsplash-removed.test.ts`; add setup, set-block, legacy, and Pixabay coverage in `test/app/unsplash-setup-removed.test.ts` (static absence waits for WU6b2). Retain `src/app/unsplash-setup-service.ts` and `test/app/unsplash-setup-service.test.ts`. V: Proof(1). H: `npm run build; node dist/cli/program.js --json config unsplash setup SAFE_SENTINEL` → exit 3/no Unsplash guidance. RB: restore routing/help and old command test; remove new tests.
- [x] **4.2.2 WU6b2 (~365):** Change the `unsplash.*` set guard to generic invalid input; tighten existing removal assertions to no guidance, then add static absence checks; delete `src/app/unsplash-setup-service.ts` and `test/app/unsplash-setup-service.test.ts`. V: Proof(2). H: temp-project `config set unsplash.accessKey SAFE_SENTINEL` → exit 3/no write; built CLI still rejects setup. RB: restore both deleted files and revert guard/test additions.

### 4.3 WU6c re-slice

Dependency: WU6b2 `7e54d52` → WU6c1 → WU6c2 → WU6c3a → WU6c3b. Each estimate is raw additions+deletions and is below 400.
Proof(c1): `npx vitest run test/config/user-config-unsplash.test.ts test/app/unsplash-credential-precedence.test.ts test/app/unsplash-setup-removed.test.ts test/app/pixabay-credential-precedence.test.ts test/app/pixabay-setup-service.test.ts test/commands/config-unsplash-removed.test.ts test/commands/config-pixabay-setup.test.ts && npm run typecheck`.
Proof(c2): CLI enum + e2e rejection focused suite + typecheck (see apply-progress when cut).
Proof(c3a): obsolete Unsplash pick test deletion suite (pick-semantic-service cleanup + pick-unsplash-credential delete) + typecheck/build/lint — prior verification 26 tests.
Proof(c3b): `npx vitest run test/app/pick-unsplash-removed.test.ts test/app/pick-semantic-service.test.ts test/integration/pick-pixabay.test.ts test/commands/pick-semantic-options.test.ts test/e2e/pick-source-rejection.test.ts && npm run typecheck`.

- [x] **4.3.1 WU6c1 (~379):** P:WU6b2; Remove `resolveUnsplashCredential` / `MissingUnsplashCredentialError` / `ResolvedUnsplashCredential` from `src/app/runtime.ts`; strip legacy `unsplash` from `src/config/user-config.ts` normalized schema while preserving on-disk block on write; drop pick CLI credential wiring; rewrite `test/config/user-config-unsplash.test.ts` + `test/app/unsplash-credential-precedence.test.ts`; tighten `test/app/unsplash-setup-removed.test.ts` list/get strip. Residual `--source unsplash` enum/service port deferred to WU6c2/c3. V: Proof(c1). H: built CLI config list/get no leak + set blocked + on-disk preserved + pixabay setup guidance. RB: restore runtime resolver/schema + prior tests.
- [x] **4.3.2 WU6c2 (~217):** P:WU6c1; CLI `--source` enum local|pixabay only; reject `--source unsplash` invalid_input/exit 3 before service; update `test/commands/pick-semantic-options.test.ts`; add `test/e2e/pick-source-rejection.test.ts`; shrink/remove unsplash-only CLI acceptance tests. Residual pick-service implementation may remain unreachable until WU6c3. V: Proof(c2). H: built CLI pick --source unsplash exit 3. RB: restore VALID_SOURCES + tests.
- [x] **4.3.3a WU6c3a (~295):** P:WU6c2 `6be2787`; Delete obsolete Unsplash pick coverage only — `test/app/pick-unsplash-credential.test.ts` + residual Unsplash cases in `test/app/pick-semantic-service.test.ts`. No production teardown. V: Proof(c3a) prior 26 tests + typecheck/build/lint. H: dedicated credential suite gone; semantic suite no longer exercises Unsplash success path. RB: restore the two test files from pre-WU6c3a. Commit `9ce6678` (295 raw deletions). Under 400 budget.
- [x] **4.3.3b WU6c3b (~292):** P:WU6c3a `9ce6678`; Delete pick-service Unsplash port/dispatch/implementation/helpers; `PickSource = local|pixabay`; add `test/app/pick-unsplash-removed.test.ts` static absence guard. No docs (WU7). V: Proof(c3b). H: built CLI pick --source unsplash exit 3 enum; src scan no residual Unsplash pick symbols. RB: restore Unsplash block in `src/app/pick-service.ts`; delete static guard test. Under 400 budget (255 + 37 = 292 raw).

## Phase 5: Documentation and Release Gate
- [x] 5.1 WU7 (~260): P:WU6c3b; update README, project skill, and `docs/providers/pixabay.md`.
- [x] 5.2 Final verification (0): P:WU7; run `npm test && npm run build && npm run typecheck && npm run lint && npm run format` plus fixture CLI checks.
- [x] 5.3 Final-verification remediation (CRIT-001/002/003): stabilize `test/integration/pick-pixabay.test.ts` (rmWithRetry + split cases); remove Unsplash token from `docs/providers/pixabay.md`; record scoped historical `size:exception` for `157ccdd`/`243774d`. Failed verify report preserved. Ready for independent sdd-verify rerun (do not self-PASS).
- [x] 5.4 Final-verification remediation (CRIT-004): stabilize `test/integration/optimization-flow.test.ts` EXIF-orientation case by planting Orientation=6 via embedded JPEG fixture (no live `exiftool.write`); retain dynamic `afterAll` singleton shutdown; static guard against reintroducing native fixture planting. No Vitest timeout inflation. Commit `b0ca039` (**89** raw). Candidate-bound review `review-1937fac6d3f7e1c2` approved target `sha256:18837501151b6e2c046fc724c06a8e5fcb50b6142d20307143a213236e4c21d5` after bounded R3-001 correction (**6** raw). Prior FAIL verify reports preserved. Ready for independent sdd-verify (do not self-PASS).
- [x] 5.5 Final-verification remediation (CRIT-001 recurrence): split Pixabay success mega-test in `test/integration/pick-pixabay.test.ts` into four autonomous scenarios so each stays under Vitest's 5s default (no timeout inflation). Commit `e79db70` (**73** raw: 56 add + 17 del) on `fix/pixabay-success-test-stability`. Focused file 5/5 (6/6 each); relevant 19-file suite 3/3 (19 files / 89 tests); full `npm test` 2/2 (55 files / 433 tests); typecheck/lint/format/build clean. Candidate-bound review `review-c9501ee29b923011` approved with pre-commit allow. This task records remediation evidence only — prior admitted FAIL `verify-report.md` preserved; **fresh independent sdd-verify is still required** (do not self-PASS).
- [x] 5.6 Final-verification remediation (CRIT-005): minimum OpenSpec delta syntax fix — `openspec/changes/replace-unsplash-with-pixabay/specs/image-source-pixabay/spec.md` header `## Requirements` → `## ADDED Requirements` so strict validation recognizes 8 requirements / 16 scenarios. Failed evidence revision `sha256:6f67dd4130a710b5d3a0ecf450fae7638756f39ad5e41fb78338554fdfb7e7c4`. Proof: `npm run openspec:validate -- replace-unsplash-with-pixabay` → exit 0 (`Change 'replace-unsplash-with-pixabay' is valid`). No production/test code; no commit; admitted FAIL `verify-report.md` preserved unchanged. **Fresh independent sdd-verify is still required** (do not self-PASS).
