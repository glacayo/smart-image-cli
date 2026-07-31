# Apply Progress

## Change

`provider-setup-and-model-selection`

## Slice

PR5 — doctor/docs/final gates + beta cleanup/testing prep.

## Mode

Strict TDD.

## Delivery

- Strategy: auto-chain / feature-branch-chain
- Branch: `feat/provider-setup-final-polish`
- Base: merged PR4 on main
- Review budget note: authored PR5 diff ≈ 860 lines (prod/docs ~220 + focused tests ~490 + legacy doctor test migration/prettier ~150). Kept as one cohesive final-polish unit (doctor reachability + docs + gates + beta cleanup). **Over 400-line budget** — no clean sub-split without breaking doctor check contracts or leaving untested redaction/e2e seams. Reviewer may treat `doctor-service.ts` + README as core and tests as secondary. Documented size:exception warning for this cohesive slice (same pattern as PR3/PR4).

## Scope

- Replace deferred `provider-ping` with real metadata-only `provider-endpoint` + `provider-model` checks via `ModelDiscoveryClient`.
- Doctor reports active provider/endpoint/model (redacted); unreachable model points to `img config setup`.
- README provider setup/model/doctor guidance; doctor command help text.
- Setup → `resolveProviderConfig` reuse coverage for analyze wiring.
- Final gates: typecheck, lint, format, build, openspec validate, focused + full tests.
- Beta cleanup at `C:\laragon\www\test-img-ia-analyzer-resizermain` (package artifacts only; `CUSTOMER-IMAGES` untouched).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1 Doctor RED | `test/app/doctor-service.test.ts`, `test/e2e/doctor.test.ts` | Unit + e2e | ✅ 13/13 existing doctorService | ✅ Failing: no `fetchImpl`/provider-endpoint/model checks | Driven by 5.2 | ✅ healthy reachability, missing model → config setup, auth fail, redaction, no-key skip, discovery unsupported | N/A (tests) |
| 5.2 GREEN/REFACTOR | `src/app/doctor-service.ts`, `README.md`, `src/commands/doctor.ts`, legacy doctor tests, setup→resolve test | App + docs | ✅ Prior doctor green | Driven by 5.1 | ✅ Focused doctor 40/40 + setup resolve; related provider 65/65 | Covered design checks + redaction + e2e | ✅ Removed deferred ping/`doctor_not_verified`; `fetchImpl` seam; prettier on touched files |
| 5.3 Gates | verification commands | Quality | N/A | N/A | ✅ typecheck/lint/format/build/openspec validate; full suite 356/357 (1 pre-existing flaky optimize timeout, re-run green) | N/A | N/A |
| 5.4 Beta cleanup | site under `test-img-ia-analyzer-resizermain` | Ops | CUSTOMER-IMAGES count 19→19 | N/A | ✅ uninstall + remove node_modules/lock/tgz | N/A | N/A |

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npm test -- test/app/doctor-service.test.ts test/e2e/doctor.test.ts test/app/config-doctor-library.test.ts test/app/setup-service.test.ts` → **51/51 passed** |
| Related regression | `npm test -- test/app/doctor-service.test.ts test/e2e/doctor.test.ts test/app/setup-service.test.ts test/commands/config-setup.test.ts test/e2e/config-setup.test.ts test/app/config-service-models.test.ts test/adapters/vision` → **65/65 passed** |
| Runtime harness command/scenario and exact result | In-process `runCli` doctor e2e with stubbed `fetch` + isolated `APPDATA`/`XDG_CONFIG_HOME`: healthy discovery → exit 0 with `provider-endpoint`/`provider-model` ok; missing model → exit 5 message contains `config setup`; no API key on stdout/stderr/JSON. Live network not required (seams inject `fetchImpl`/global fetch). |
| Rollback boundary | Revert `src/app/doctor-service.ts`, `src/commands/doctor.ts`, `README.md`, doctor/setup test files, apply-progress/tasks marks. Beta cleanup is site-local (reinstall from new tgz for beta 2). No schema migration. |

### Test Summary

- **Total tests written (PR5)**: 9 new (6 doctor-service unit + 2 doctor e2e + 1 setup→resolveProviderConfig)
- **Total tests passing**: 356 full suite stable; flaky optimize orientation timed out once then passed on re-run
- **Layers used**: Unit (doctor-service), Integration (legacy doctor library migration), E2E (doctor CLI)
- **Approval tests** (refactoring): Legacy doctor tests updated as approval/migration for new check names
- **Pure functions created**: 0 (orchestration in doctorService; discovery client reused)

## Verification Evidence

| Command | Result |
|---------|--------|
| Focused PR5 doctor/setup tests | 51/51 passed |
| Related provider/setup/models safety | 65/65 passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run format` | Passed (after prettier --write on touched src) |
| `npm run build` | Passed |
| `npm run openspec:validate -- provider-setup-and-model-selection` | Passed (`Change 'provider-setup-and-model-selection' is valid`) |
| `npm test` full | 356 passed / 1 failed once (`optimization-flow` EXIF orientation 5s timeout — pre-existing flake); re-run of that test **passed** |

## Beta cleanup / testing prep (5.4)

Target: `C:\laragon\www\test-img-ia-analyzer-resizermain`

| Action | Detail |
|--------|--------|
| Uninstalled | `smart-image-cli` (was `file:.atl/smart-image-cli-0.1.0.tgz`) |
| Removed | `node_modules/`, `package-lock.json`, `.atl/smart-image-cli-0.1.0.tgz` |
| Preserved | `CUSTOMER-IMAGES/` (19 entries before = 19 after), site `css/`, `js/`, `img/`, `index.html`, `package.json`, `.atl/` dir |
| Deferred | Fresh beta 2 package install / controlled re-test (await new build/tgz after PR5 merge) — intentionally not reinstalled here |

## Status

PR5 implementation complete. Ready for sdd-verify / review / commit (do not open PR unless requested).

## Cumulative completed slices

- PR1 typed errors/default — done
- PR2 model discovery + vision hints — done
- PR3 config models + key connection test — done
- PR4 setup wizard — done
- PR5 doctor/docs/gates + beta cleanup — done (this slice)
