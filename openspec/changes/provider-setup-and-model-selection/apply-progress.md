# Apply Progress

## Change

`provider-setup-and-model-selection`

## Slice

PR3 — `config models` + API-key connection test.

## Mode

Strict TDD.

## Delivery

- Strategy: auto-chain / feature-branch-chain
- Branch: `feat/provider-config-models`
- Base: merged PR2 on main
- Review budget note: authored PR3 diff ≈ 680–700 lines (prod ~290 + focused tests ~390). Kept as one cohesive work unit (shared provider resolution + discovery client). Over 400-line budget; no clean sub-split without breaking the models/key-test contract. Reviewer may treat tests as secondary to `config-service.ts` / `config.ts` core.

## Scope

- Add `config models` action listing provider models via `ModelDiscoveryClient`.
- Annotate listings with vision hints; warn-not-block for unknown/non-vision.
- Fallback messaging when discovery unsupported/unparseable (`source: "unavailable"`).
- Wire API-key `config set` to connection test (GET `/models`); JSON `connectionTest` + human stderr outcome.
- CLI flags: `--provider`, `--endpoint`.
- Typed errors: `provider_auth`, `endpoint_not_found`, `model_not_found` → exit 4; no secret leakage.
- Out of scope: PR4 setup wizard, PR5 doctor/docs/beta cleanup.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 Models/key-set RED | `test/app/config-service-models.test.ts`, `test/commands/config.test.ts` | Unit + command integration | ✅ 33/33 `config-doctor-library` | ✅ 10 failing before impl | ✅ 12/12 after GREEN | ✅ discovery success, unavailable fallback, auth, endpoint 404, provider/endpoint overrides, missing key, key-set ok/fail/stderr/non-apiKey, CLI flag routing | ✅ Compacted helpers + `providerFailure` |
| 3.2 GREEN/REFACTOR | `src/app/config-service.ts`, `src/commands/config.ts` | App + CLI | ✅ Existing config tests still green | Driven by 3.1 | ✅ Focused + full suite | Covered design JSON shapes | ✅ exactOptionalPropertyTypes-safe option spreads |

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npm test -- test/app/config-service-models.test.ts test/commands/config.test.ts test/app/config-doctor-library.test.ts` → 45/45 passed |
| Runtime harness command/scenario and exact result | N/A for live network in apply — seams inject `fetchImpl`; live Ollama metadata already recorded in PR1/PR2. Optional local: `node dist/cli/program.js config models --json` after build with user config. |
| Rollback boundary | Revert `src/app/config-service.ts`, `src/commands/config.ts`, `test/app/config-service-models.test.ts`, `test/commands/config.test.ts`, and this apply-progress/tasks marks. No schema migration. |

### Test Summary

- **Total tests written**: 12 new (10 service + 2 command)
- **Total tests passing**: 330 full suite
- **Layers used**: Unit (service), Integration/command (CLI flags)
- **Approval tests** (refactoring): None — additive behavior
- **Pure functions created**: 0 new modules; local helpers in config-service

## Verification Evidence

| Command | Result |
|---------|--------|
| Focused PR3 tests | 12/12 passed |
| Config + discovery/hints safety | 67/67 passed (earlier batch) |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run openspec:validate -- provider-setup-and-model-selection` | Passed |
| `npm test` | 330/330 passed |

## Status

PR3 implementation complete. Ready for sdd-verify / review / commit (do not open PR unless requested).
