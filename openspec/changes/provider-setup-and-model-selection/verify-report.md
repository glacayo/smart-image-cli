```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:2eca235f03f8554c1729aff1a350d7fb57cef1992249e0eb3638b4f315445847
verdict: pass
blockers: 0
critical_findings: 0
requirements: 9/9
scenarios: 17/17
test_command: "& \"C:\\laragon\\bin\\nodejs\\node-v22\\npm.cmd\" test"
test_exit_code: 0
test_output_hash: sha256:0b60693a805a75053d555ec5ffbbfa3652f9045173afd29d86bb0175aa986ded
build_command: "& \"C:\\laragon\\bin\\nodejs\\node-v22\\npm.cmd\" run build"
build_exit_code: 0
build_output_hash: sha256:01eb719a642fb187f6f513d9151b5ed21d94cd0a1019b40fd935215d5ee5c08d
```
## Verification Report

**Change**: `provider-setup-and-model-selection`
**Scope**: PR4 only — guided provider setup wizard (`config setup`)
**Branch**: `feat/provider-setup-wizard`
**Artifact store**: OpenSpec
**Mode**: Strict TDD
**Spec inventory read**: 9 requirements / 17 scenarios total; PR4 verification scope covers 5 requirements / 8 scenarios.
**Out-of-scope by user instruction**: PR5 doctor/docs/beta cleanup remains pending and was not treated as a PR4 failure.

---

### Completeness

| Metric | Value |
|--------|-------|
| PR4 tasks total | 3 |
| PR4 tasks complete | 3 |
| PR4 tasks incomplete | 0 |
| Out-of-scope PR5 tasks pending | 4 |

PR4 task status from `tasks.md`: 4.1, 4.2, and 4.3 are checked. PR5 tasks 5.1-5.4 are unchecked but explicitly excluded from this verification.

---

### Build & Tests Execution

| Command | Exit | Result | Output hash |
|---------|------|--------|-------------|
| `& "C:\laragon\bin\nodejs\node-v22\npm.cmd" test -- test/app/setup-service.test.ts test/cli/prompter.test.ts test/e2e/config-setup.test.ts test/commands/config-setup.test.ts` | 0 | 4 files, 18 tests passed | `sha256:fc3334cde6a78da36851aba4d8160efd6b74134e6e18636e4dfdb56c4625387a` |
| `& "C:\laragon\bin\nodejs\node-v22\npm.cmd" test -- test/app/config-service-models.test.ts test/commands/config.test.ts test/adapters/vision/model-discovery.test.ts test/adapters/vision/vision-hints.test.ts test/app/config-doctor-library.test.ts` | 0 | 5 files, 67 tests passed | `sha256:ba1556f33a09fb799d5edf7a33c017042681b84567d48de8fcddd2848e5b5826` |
| `& "C:\laragon\bin\nodejs\node-v22\npm.cmd" run typecheck` | 0 | Passed (`tsc --noEmit`) | `sha256:aef01e2f065c5b263a5bc6876dc5e7c55eccce9a567b9a7c18e335732b264e48` |
| `& "C:\laragon\bin\nodejs\node-v22\npm.cmd" run lint` | 0 | Passed (`eslint .`) | `sha256:f81447fe2fa74ed041bb627a097fc396121743f5fa6261ca44b01d7263a883c7` |
| `& "C:\laragon\bin\nodejs\node-v22\npm.cmd" run openspec:validate -- provider-setup-and-model-selection` | 0 | Passed (`Change 'provider-setup-and-model-selection' is valid`) | `sha256:b31a8ae8f851b7f8021cd8fb5a4f215743664311acfa3320b94329b70ed71b3e` |
| `& "C:\laragon\bin\nodejs\node-v22\npm.cmd" test` | 0 | 35 files, 348 tests passed | `sha256:0b60693a805a75053d555ec5ffbbfa3652f9045173afd29d86bb0175aa986ded` |
| `& "C:\laragon\bin\nodejs\node-v22\npm.cmd" run build` | 0 | Passed (`tsc -p tsconfig.json`) | `sha256:01eb719a642fb187f6f513d9151b5ed21d94cd0a1019b40fd935215d5ee5c08d` |

**test_output_hash**: `sha256:0b60693a805a75053d555ec5ffbbfa3652f9045173afd29d86bb0175aa986ded`  
**build_output_hash**: `sha256:01eb719a642fb187f6f513d9151b5ed21d94cd0a1019b40fd935215d5ee5c08d`

Coverage: ➖ Not available (`openspec/config.yaml` marks coverage unavailable; threshold 0).

---

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | `apply-progress.md` contains a PR4 TDD Cycle Evidence table. |
| All PR4 tasks have tests | ✅ | 3/3 PR4 task rows list test files. |
| RED confirmed (tests exist) | ✅ | `test/app/setup-service.test.ts`, `test/e2e/config-setup.test.ts`, `test/commands/config-setup.test.ts`, and `test/cli/prompter.test.ts` exist and were executed. |
| GREEN confirmed (tests pass) | ✅ | Focused PR4 tests passed: 18/18. |
| Triangulation adequate | ✅ | Non-TTY happy/incomplete/auth/endpoint/manual/non-vision/update, TTY prompt/manual/confirm, CLI routing, and e2e no-hang/no-leak paths are covered. |
| Safety Net for modified files | ✅ | Apply evidence reports prior config/doctor/models/command safety nets for modified routing; prompter is new. |

**TDD Compliance**: 6/6 checks passed

---

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 14 | 2 | Vitest (`setup-service`, `prompter`) |
| Integration / command | 1 | 1 | Vitest + Commander seam |
| E2E | 3 | 1 | Vitest in-process CLI harness |
| **Total PR4 focused** | **18** | **4** | |

---

### Changed File Coverage

Coverage analysis skipped — no coverage tool detected in OpenSpec testing capabilities.

---

### Assertion Quality

**Assertion quality**: ✅ All reviewed PR4 assertions verify real behavior. No tautologies, ghost loops, type-only standalone assertions, or secret-insensitive smoke tests were found in the four PR4-focused test files.

---

### Quality Metrics

**Linter**: ✅ No errors (`npm run lint`)  
**Type Checker**: ✅ No errors (`npm run typecheck`)  
**OpenSpec Validate**: ✅ Passed

---

### Spec Compliance Matrix (PR4 Scope)

| Requirement | Scenario | Test evidence | Result |
|-------------|----------|---------------|--------|
| Guided Setup Flow | Interactive happy path | `test/app/setup-service.test.ts` > `uses prompter for provider, masked key, and model when flags are absent` | ✅ COMPLIANT |
| Guided Setup Flow | Non-interactive agent setup | `test/e2e/config-setup.test.ts` > `completes non-interactive setup with flags and does not echo the api key`; `test/app/setup-service.test.ts` > non-TTY happy path | ✅ COMPLIANT |
| Key Validation Without Leakage | Invalid key rejected safely | `test/app/setup-service.test.ts` > `surfaces typed auth failure with exit 4 and does not leak the key`; `test/e2e/config-setup.test.ts` > invalid key exit 4/no leak | ✅ COMPLIANT |
| Model Discovery With Fallback | Models listed for selection | `test/app/setup-service.test.ts` > interactive prompter model selection with discovered list; source constructs recommended/other model choices before `prompter.select` | ✅ COMPLIANT |
| Model Discovery With Fallback | Discovery unavailable | `test/app/setup-service.test.ts` > manual model flag when unsupported; `prompts for manual model id when discovery is unavailable` | ✅ COMPLIANT |
| Vision Capability Guidance | Vision-capable models highlighted | `test/app/setup-service.test.ts` > non-TTY happy path asserts `visionHint`; source labels recommended choices with `(recommended)` | ✅ COMPLIANT |
| Vision Capability Guidance | Non-vision candidate warned, not blocked | `test/app/setup-service.test.ts` > `warns on non-vision model but still persists when --yes is set`; TTY confirm test | ✅ COMPLIANT |
| Model Selection Persistence | Persisted selection reused | `test/app/setup-service.test.ts` and `test/e2e/config-setup.test.ts` assert user-scoped persisted provider/model/key; `src/app/runtime.ts` resolves `user.activeProvider` and provider model for subsequent runtime use. No PR4 test executes `img analyze` after setup. | ⚠️ PARTIAL |

**PR4 compliance summary**: 7/8 scenarios compliant, 1/8 partial, 0 failing, 0 untested.

Out-of-scope scenarios from the same OpenSpec change were not failed for PR4: AI provider discovery/default/typed-error scenarios are PR1-PR2 foundations guarded by related regression tests; `config models` and key-set connection are PR3 guarded by related regression tests; doctor reachability/docs scenarios are PR5 pending by task plan.

---

### Correctness (Static — Structural Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Guided Setup Flow | ✅ Implemented | `setupService` orchestrates provider → key → connection test → discovery/list/manual model → user config write. `config.ts` exposes `config setup` flags and forces non-TTY behavior in JSON mode. |
| Key Validation Without Leakage | ✅ Implemented | `ModelDiscoveryClient.testConnection()` runs before persistence; provider failures are mapped to typed exit 4 results and redacted with `defaultSecretRedactor`. |
| Model Discovery With Fallback | ✅ Implemented | Supported listings use annotated model choices; unsupported listings set source `manual` and allow manual entry/flag. |
| Vision Capability Guidance | ✅ Implemented | `annotateModelsWithVisionHints`, `resolveVisionHint`, and warning/confirm flow steer but do not block. No image probe is issued. |
| Model Selection Persistence | ⚠️ Partial runtime proof | Implementation writes user-scoped config via `writeUserConfig` mode `0600`; tests assert persistence. Runtime reuse is structurally present through `resolveProviderConfig`, but not proven by a PR4 analyze-after-setup test. |

---

### Coherence (Design)

| Decision / Design Point | Followed? | Notes |
|-------------------------|-----------|-------|
| Wizard placement in `setup-service.ts` with injected prompter/fetch/user config seams | ✅ Yes | `SetupServiceOptions` includes `fetchImpl`, `prompter`, `userConfigPath`, `isTty`, and `stderr`. |
| Connection test uses metadata endpoint, not paid chat/image probe | ✅ Yes | `setupService` calls `ModelDiscoveryClient.testConnection()` / `listModels()`; discovery client uses `GET {endpoint}/models`. |
| TTY uses masked key prompt; non-TTY uses flags | ✅ Yes | `createReadlinePrompter.password()` uses muted output; `config.ts --json` passes `isTty:false`; incomplete flags exit 3. |
| JSON/non-TTY output contract | ✅ Yes | E2E verifies exactly one JSON object for incomplete non-TTY setup and no API key in stdout/stderr/JSON. |
| No schema migration | ✅ Yes | Setup writes existing `activeProvider` and `providers.<id>` fields. |
| Chained PR review budget | ⚠️ Deviated | `apply-progress.md` records PR4 authored diff at about 1,100 lines versus the 400-line budget, with a cohesive-slice exception. |

---

### No-Secret / Redaction Evidence

- Focused PR4 tests assert setup result JSON, stdout, and stderr do not contain entered API keys.
- Invalid-key tests inject provider error bodies containing the key and verify the returned error/result does not leak it.
- Project config schema rejects secret-looking values; PR4 setup writes to user-scoped config only.
- Verification report intentionally excludes raw test API key literals.

---

### Non-Interactive / No-Hang Evidence

- `src/commands/config.ts` forces `{ isTty: false }` when `--json` is used.
- `setupService` returns `invalid_input` exit 3 before network or prompter calls when required non-TTY flags are missing.
- E2E test `exits 3 without hanging when required flags are missing` passed in the focused PR4 command run.

---

### Issues Found

**CRITICAL** (must fix before archive):
None.

**WARNING** (should fix):
1. PR4 exceeded the 400-line review budget (`apply-progress.md` reports about 1,100 authored lines). The slice is cohesive, but review risk remains.
2. `Persisted selection reused` is only partially proven at runtime: tests prove user-scoped persistence, and source inspection shows subsequent runtime config resolution uses it, but no PR4 test runs `img analyze` after setup.

**SUGGESTION** (nice to have):
- Add a small analyze-after-setup integration/e2e test in PR5 or follow-up to close the partial persistence-reuse proof.

---

### Verdict

PASS WITH WARNINGS

PR4 guided provider setup wizard is implemented, statically coherent with the PR4 design, and passed all focused, related, quality, OpenSpec, build, and full-suite commands. Remaining warnings are review-size risk and one partial runtime proof for analyze reuse; PR5 pending work was deliberately excluded from the verdict.