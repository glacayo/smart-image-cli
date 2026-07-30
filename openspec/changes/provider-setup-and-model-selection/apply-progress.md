# Apply Progress

## Change

`provider-setup-and-model-selection`

## Slice

PR4 — guided provider setup wizard (`config setup`).

## Mode

Strict TDD.

## Delivery

- Strategy: auto-chain / feature-branch-chain
- Branch: `feat/provider-setup-wizard`
- Base: merged PR3 on main
- Review budget note: authored PR4 diff ≈ 1,100 lines (prod ~485 + focused tests ~615). Kept as one cohesive work unit (setup orchestration + prompter + CLI flags + non-TTY/e2e contracts). **Over 400-line budget** — no clean sub-split without breaking the interactive/non-interactive setup contract or leaving untested prompter seams. Reviewer may treat `setup-service.ts` + `prompter.ts` as core and tests as secondary. Documented size:exception warning for this cohesive slice (same pattern as PR3).

## Scope

- Add `img config setup` guided flow: provider → API key → connection test → model discovery/selection → user-scoped persist.
- Non-TTY / `--json`: require `--provider`, `--api-key`, `--model` (optional `--endpoint`, `--yes`); never prompt; exit `3` if incomplete.
- TTY: `prompter` seam (masked password, select, input, confirm); manual model when discovery unavailable.
- Vision hints: recommend vision models; warn-not-block on unknown/non-vision (`--yes` or confirm).
- Typed failures: `provider_auth` / `endpoint_not_found` → exit `4`; no secret leakage on stdout/stderr/JSON.
- Wire flags in `src/commands/config.ts`; route `setup` via `configService` → `setupService`.
- Out of scope: PR5 doctor/docs/beta cleanup.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 Setup service RED | `test/app/setup-service.test.ts`, `test/e2e/config-setup.test.ts`, `test/commands/config-setup.test.ts` | Unit + e2e + command | ✅ 45/45 config-doctor/models/command | ✅ Failing imports + incomplete/happy/auth paths before impl | ✅ 18/18 focused after GREEN | ✅ non-TTY happy, incomplete exit 3, auth 4, endpoint 404, manual fallback, non-vision+yes, existing config update, TTY prompter/manual/confirm, e2e no-hang/no-leak, CLI flag routing | ✅ Fresh Response per fetch mock; listModels errors typed |
| 4.2 Prompter RED | `test/cli/prompter.test.ts` | Unit | N/A (new) | ✅ Module missing then assertion fails | ✅ 4/4 | ✅ isTty matrix, masked password, select+input, confirm default/no | ✅ Muted stdout writer for password |
| 4.3 GREEN/REFACTOR | `src/app/setup-service.ts`, `src/cli/prompter.ts`, `src/app/config-service.ts`, `src/commands/config.ts` | App + CLI | ✅ Prior PR3 tests green | Driven by 4.1–4.2 | ✅ Focused 18/18 + full 348/348 | Covered design JSON shape + flags | ✅ `--json` forces `isTty:false`; exactOptionalPropertyTypes-safe option spreads |

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npm test -- test/app/setup-service.test.ts test/cli/prompter.test.ts test/e2e/config-setup.test.ts test/commands/config-setup.test.ts` → **18/18 passed** |
| Related regression | `npm test --` (setup + config models + discovery/hints + doctor library) → **85/85 passed** |
| Runtime harness command/scenario and exact result | Non-TTY e2e via in-process `runCli` with stubbed `fetch` and isolated `APPDATA`/`XDG_CONFIG_HOME`: incomplete flags → exit 3 single JSON; full flags → persist user config + connectionTest ok; auth 401 → exit 4; no key on stdout/stderr. Live network not required in apply (seams inject `fetchImpl`). |
| Rollback boundary | Revert `src/app/setup-service.ts`, `src/cli/prompter.ts`, `src/app/config-service.ts` (setup route only), `src/commands/config.ts` (setup flags), and the four new test files + this apply-progress/tasks marks. No schema migration. |

### Test Summary

- **Total tests written**: 18 new (10 setup-service + 4 prompter + 3 e2e + 1 command)
- **Total tests passing**: 348 full suite
- **Layers used**: Unit (setup-service, prompter), Integration/command (CLI flags), E2E (non-TTY setup)
- **Approval tests** (refactoring): None — additive behavior
- **Pure functions created**: `isInteractiveTty`; setup helpers remain module-private

## Verification Evidence

| Command | Result |
|---------|--------|
| Focused PR4 tests | 18/18 passed |
| Related config/discovery safety | 85/85 passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run openspec:validate -- provider-setup-and-model-selection` | Passed |
| `npm test` | 348/348 passed |

## Status

PR4 implementation complete. Ready for sdd-verify / review / commit (do not open PR unless requested).

## Cumulative completed slices

- PR1 typed errors/default — done
- PR2 model discovery + vision hints — done
- PR3 config models + key connection test — done
- PR4 setup wizard — done (this slice)
- PR5 doctor/docs/gates — pending
