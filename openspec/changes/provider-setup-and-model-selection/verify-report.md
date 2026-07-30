```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:273149fd081a5e2b5005afc95e2dbe5c37e3108715b3a5714ccd7aff3d0dfec0
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 5/5
scenarios: 9/9
test_command: npm test -- test/app/config-service-models.test.ts test/commands/config.test.ts test/app/config-doctor-library.test.ts
test_exit_code: 0
test_output_hash: sha256:1d8c6444ffaa5202cc4fcffa70acd6404c3ff589202d5ecd323ad70bed255d9b
build_command: npm run typecheck
build_exit_code: 0
build_output_hash: sha256:aef01e2f065c5b263a5bc6876dc5e7c55eccce9a567b9a7c18e335732b264e48
```

## Verification Report

**Change**: provider-setup-and-model-selection
**Scope**: PR3 only — `config models` + API-key connection test
**Artifact store**: OpenSpec
**Mode**: Strict TDD
**Branch**: feat/provider-config-models
**Verdict**: PASS WITH WARNINGS

> Scope note: the retrieved specs contain 9 requirements and 17 scenarios across the full chained change. This verification intentionally covers the PR3-relevant subset only: 5 requirements and 9 scenarios. PR4 setup wizard and PR5 doctor/docs/final-gate tasks remain deferred and were not treated as failures.

---

### Completeness

| Metric | Value |
|--------|-------|
| Full change requirements/scenarios retrieved | 9 requirements / 17 scenarios |
| PR3-scoped requirements/scenarios evaluated | 5 requirements / 9 scenarios |
| PR3 tasks total | 2 |
| PR3 tasks complete | 2 |
| PR3 tasks incomplete | 0 |
| Deferred non-PR3 tasks | PR4-PR5 task lines + full-chain done criteria |

PR3 task evidence:

| Task | Status | Evidence |
|------|--------|----------|
| 3.1 RED: `config models --json` and API-key set tests for single JSON, fallback, stderr/JSON connection outcome, user-scope persistence, redaction | ✅ Complete | `test/app/config-service-models.test.ts`, `test/commands/config.test.ts`; apply-progress TDD evidence records 10 failing cases before implementation and 12/12 green after implementation. |
| 3.2 GREEN/REFACTOR: modify `src/app/config-service.ts` and `src/commands/config.ts` for `models`, key-test wiring, `--provider`, `--endpoint` | ✅ Complete | Source inspection confirms `configService("models")`, API-key set connection test, provider/endpoint overrides, stderr human outcome, and Commander flags. |

Skipped by request/scope: PR4 setup wizard/prompter and PR5 doctor/docs/beta cleanup. Existing PR1/PR2 behavior was exercised indirectly by the full test suite.

---

### Build & Tests Execution

Environment note: the initial shell PATH did not expose `npm`; verification prepended `C:\Program Files\nodejs` to PATH and then executed the requested `npm ...` commands unchanged.

| Command | Exit | Output hash | Result |
|---------|------|-------------|--------|
| `npm test -- test/app/config-service-models.test.ts test/commands/config.test.ts test/app/config-doctor-library.test.ts` | 0 | `sha256:1d8c6444ffaa5202cc4fcffa70acd6404c3ff589202d5ecd323ad70bed255d9b` | ✅ 3 files, 45 tests passed |
| `npm run typecheck` | 0 | `sha256:aef01e2f065c5b263a5bc6876dc5e7c55eccce9a567b9a7c18e335732b264e48` | ✅ Passed |
| `npm run lint` | 0 | `sha256:f81447fe2fa74ed041bb627a097fc396121743f5fa6261ca44b01d7263a883c7` | ✅ Passed |
| `npm run openspec:validate -- provider-setup-and-model-selection` | 0 | `sha256:b31a8ae8f851b7f8021cd8fb5a4f215743664311acfa3320b94329b70ed71b3e` | ✅ Change is valid |
| `npm test` | 0 | `sha256:196b39ba30a4dbded4f94f90637f427cc07a98efb7854674c790418bd8a79746` | ✅ 31 files, 330 tests passed |

Focused output summary:

```text
Test Files  3 passed (3)
Tests       45 passed (45)
```

Full-suite output summary:

```text
Test Files  31 passed (31)
Tests       330 passed (330)
```

**Coverage**: ➖ Skipped — `openspec/config.yaml` marks coverage as unavailable (`coverage.available: false`).

---

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | `apply-progress.md` contains a PR3 `TDD Cycle Evidence` table. |
| All PR3 tasks have tests | ✅ | 2/2 PR3 tasks reference test files or implementation driven by those tests. |
| RED confirmed (tests exist) | ✅ | `test/app/config-service-models.test.ts` and `test/commands/config.test.ts` exist; apply-progress records 10 failing cases before implementation. |
| GREEN confirmed (tests pass) | ✅ | Focused PR3 command passed at runtime: 45/45 tests, including the PR3 tests and config safety net. |
| Triangulation adequate | ✅ | Tests cover discovery success, unavailable fallback, auth failure, endpoint 404, provider/endpoint overrides, missing key, key-set success/failure, human stderr, non-apiKey set, and CLI flag routing. |
| Safety Net for modified files | ✅ | `test/app/config-doctor-library.test.ts` passed in the focused run; full suite also passed. |

**TDD Compliance**: PASS — 6/6 Strict TDD checks passed for PR3 scope.

---

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 10 PR3 tests | 1 | Vitest |
| Integration/command | 2 PR3 tests | 1 | Vitest + Commander |
| Safety/regression | 33 existing tests | 1 | Vitest |
| E2E | 0 | 0 | Deferred to PR4/PR5 setup/doctor slices |
| **Total focused run** | **45** | **3** | |

---

### Changed File Coverage

Coverage analysis skipped — no coverage tool detected in OpenSpec testing capabilities.

---

### Assertion Quality

**Assertion quality**: ✅ All audited PR3 assertions verify real behavior. No tautologies, ghost loops, smoke-only tests, standalone type-only assertions, or empty-collection-only assertions were found in `test/app/config-service-models.test.ts` or `test/commands/config.test.ts`.

---

### Quality Metrics

**Linter**: ✅ No errors (`npm run lint`, exit 0)  
**Type Checker / Build Gate**: ✅ No errors (`npm run typecheck`, exit 0)  
**OpenSpec validation**: ✅ Passed (`npm run openspec:validate -- provider-setup-and-model-selection`, exit 0)  
**Full test suite**: ✅ Passed (`npm test`, exit 0)

---

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Provider Setup — Model Discovery With Fallback | Models listed for selection / PR3 `config models` listing surface | `test/app/config-service-models.test.ts` > lists discovered models with vision hints as a single success JSON shape | ✅ COMPLIANT for PR3 models surface; setup wizard presentation remains PR4 |
| Provider Setup — Model Discovery With Fallback | Discovery unavailable | `test/app/config-service-models.test.ts` > returns unavailable fallback when discovery body cannot be normalized | ✅ COMPLIANT |
| Provider Setup — Vision Capability Guidance | Vision-capable models highlighted | `test/app/config-service-models.test.ts` > lists discovered models with `minimax-m3` as `vision: true` | ✅ COMPLIANT |
| Provider Setup — Vision Capability Guidance | Non-vision candidate warned, not blocked | `test/app/config-service-models.test.ts` > includes warnings for `glm-5.2` and unknown models while still returning success | ✅ COMPLIANT for PR3 warn-not-block listing behavior; setup confirmation remains PR4 |
| CLI Runtime — Environment Diagnostics and Config | Key set triggers connection test | `test/app/config-service-models.test.ts` > persists user-scoped apiKey and reports `connectionTest: { ok: true }`; writes human stderr outcome without echoing key | ✅ COMPLIANT |
| CLI Runtime — Existing machine-readable output contract for new config surface | `config models --json` routes flags and emits one JSON result | `test/commands/config.test.ts` > routes config models with `--provider` and `--endpoint` to `configService` and parses stdout as one JSON object | ✅ COMPLIANT |
| AI Provider — Model Discovery and Connection Test | Models discovered via metadata endpoint | `test/app/config-service-models.test.ts` > model listing calls provider `/models` through injected `fetchImpl`; full suite covers discovery adapter normalization | ✅ COMPLIANT |
| AI Provider — Model Discovery and Connection Test | Connection test with invalid key | `test/app/config-service-models.test.ts` > reports connectionTest failure with typed `provider_auth` and still persists key without output leakage | ✅ COMPLIANT |
| AI Provider — Typed Error Surfacing | Endpoint/auth provider errors surface distinctly through config models/key test | `test/app/config-service-models.test.ts` > surfaces typed auth failure for models; surfaces typed `endpoint_not_found` for models 404 | ✅ COMPLIANT |

**Compliance summary**: 9/9 PR3-scoped scenarios compliant.

---

### Correctness (Static — Structural Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| `config models` action | ✅ Implemented | `configService()` routes `action === "models"` to `listProviderModels()`, resolving active/overridden provider, endpoint, and API key before invoking `ModelDiscoveryClient.listModels()`. |
| Model listing JSON shape | ✅ Implemented | Success details include `action`, `provider`, redacted `endpoint`, `source`, `models`, and `warnings`; unavailable listings return `source: "unavailable"`, empty models, reason, and manual fallback guidance. |
| Vision hints warn-not-block | ✅ Implemented | `annotateModelsWithVisionHints()` and `describeVisionHint()` are applied; non-vision/unknown models generate warnings without failing the command. |
| API-key set connection test | ✅ Implemented | User-scope `config set providers.<id>.apiKey` persists the key, runs `ModelDiscoveryClient.testConnection()`, and reports `connectionTest` in JSON details. |
| Human stderr outcome | ✅ Implemented | Non-JSON command mode injects `stderr`; service writes success/failure connection-test outcome to stderr without key material. |
| Provider/endpoint overrides | ✅ Implemented | `src/commands/config.ts` exposes `--provider` and `--endpoint`; `configService` uses them for model listing and API-key connection tests. |
| Typed provider failures | ✅ Implemented | Auth/model/endpoint provider errors map to `provider_auth`, `model_not_found`, and `endpoint_not_found` with exit code 4 and redacted details. |
| No-secret output behavior | ✅ Implemented | Tests assert API keys are absent from config-models JSON, command stdout, and human stderr. Static code routes messages/details through `defaultSecretRedactor`. |

---

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Layer `models` onto existing `configService` routing | ✅ Yes | Implemented in `src/app/config-service.ts`; no separate setup service introduced in PR3. |
| `config models` JSON shape | ✅ Yes | Matches design shape: `{ action, provider, endpoint, source, models[] }`, plus warning/fallback fields. |
| Connection test uses metadata-only `GET /models` | ✅ Yes | API-key set path instantiates `ModelDiscoveryClient.testConnection()`; no image-analysis probe or chat-completion spend. |
| CLI flags for PR3 provider targeting | ✅ Yes | `src/commands/config.ts` adds `--provider` and `--endpoint` and forwards them to the service. |
| Secret redaction invariant | ✅ Yes | Endpoint/details are redacted before output; tests cover key absence from stdout/stderr/result JSON. |
| PR4 setup wizard remains deferred | ✅ Yes | `setup-service.ts`, prompter, `--api-key`, `--model`, and `--yes` are not expected in PR3 and remain open in tasks. |
| PR5 doctor reachability remains deferred | ✅ Yes | Doctor spec scenarios remain out of PR3 scope; existing config/doctor safety tests pass. |

---

### Review Budget Check

| Metric | Value |
|--------|-------|
| Review budget | 400 changed lines |
| Observed PR3 additions/deletions from `git diff --numstat` | 717 additions / 35 deletions across PR3 source, tests, and OpenSpec progress artifacts |
| Source additions | 284 additions across `src/app/config-service.ts` and `src/commands/config.ts` |
| Test additions | 391 additions across `test/app/config-service-models.test.ts` and `test/commands/config.test.ts` |
| Artifact additions | 42 additions across `tasks.md` and `apply-progress.md` |

---

### Issues Found

**CRITICAL** (must fix before archive):

None.

**WARNING** (should fix):

- PR3 exceeds the 400-line review budget (717 additions / 35 deletions observed). `apply-progress.md` documents the rationale for keeping the cohesive config models/key-test work unit together, so this is a review-process warning, not a behavioral blocker.

**SUGGESTION** (nice to have):

None.

---

### Verdict

PASS WITH WARNINGS

PR3 is behaviorally compliant with its scoped specs, coherent with the relevant design, and verified by passing focused tests, typecheck, lint, OpenSpec validation, and the full test suite. The only warning is the documented review-budget overage.
