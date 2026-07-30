# Tasks: Provider Setup and Model Selection

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,500-1,800 total; 250-400/slice target |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 errors/default → PR2 discovery/hints → PR3 config models/key test → PR4 setup wizard → PR5 doctor/docs |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Typed errors/default | PR1 base=tracker | `npm test -- test/adapters/vision` | `npm run typecheck` | provider/transport/presets |
| 2 | Discovery/hints | PR2 base=PR1 | `npm test -- test/adapters/vision/model-discovery.test.ts test/adapters/vision/vision-hints.test.ts` | Live Ollama `/v1/models`; redact key | discovery/hints |
| 3 | Models/key test | PR3 base=PR2 | `npm test -- test/app/config-service.test.ts test/commands/config.test.ts` | `node dist/cli/program.js config models --json` | config service/command |
| 4 | Setup wizard | PR4 base=PR3 | `npm test -- test/app/setup-service.test.ts test/e2e/config-setup.test.ts` | Non-TTY `config setup --json --provider --api-key --model` | setup/prompter |
| 5 | Doctor/docs/gates | PR5 base=PR4 | `npm test -- test/app/doctor-service.test.ts test/e2e/doctor.test.ts` | `node dist/cli/program.js doctor --json` | doctor/README |

## Phase 1: PR1 Typed Errors / Default

- [x] 1.1 RED: `test/adapters/vision/openai-compat-transport.test.ts` for 401/403 auth, 404 model/endpoint, no key leak.
- [x] 1.2 RED/live: metadata-only Ollama `/v1/models`; choose reachable vision default; record model ids only.
- [x] 1.3 GREEN/REFACTOR: modify `src/adapters/vision/provider.ts`, `openai-compat-transport.ts`, `presets.ts`; replace `llama3.2-vision`, preserve existing error behavior.

## Phase 2: PR2 Discovery / Hints

- [x] 2.1 RED: tests for OpenAI-compatible/OpenRouter/Gemini/Ollama listings, unsupported, non-JSON, auth, `true|false|null`, warn-not-block.
- [x] 2.2 GREEN/REFACTOR: create `src/adapters/vision/model-discovery.ts` and `vision-hints.ts`; metadata-only, no image bytes/paid probes.

## Phase 3: PR3 Config Models / Key Test

- [ ] 3.1 RED: `config models --json` and API-key set tests for single JSON, fallback, stderr/JSON connection outcome, user-scope persistence, redaction.
- [ ] 3.2 GREEN/REFACTOR: modify `src/app/config-service.ts` and `src/commands/config.ts` for `models`, key-test wiring, `--provider`, `--endpoint`.

## Phase 4: PR4 Setup Wizard

- [ ] 4.1 RED: `test/app/setup-service.test.ts` for non-TTY flags, exit `3`, invalid key exit `4`, no hang, persisted analyze reuse.
- [ ] 4.2 RED: `src/cli/prompter.ts` tests for masked TTY key entry and manual model fallback.
- [ ] 4.3 GREEN/REFACTOR: create `src/app/setup-service.ts` and `src/cli/prompter.ts`; wire setup flags in `src/commands/config.ts`.

## Phase 5: PR5 Doctor / Final Gates

- [ ] 5.1 RED: doctor tests for active provider, endpoint/model reachability, unreachable model → `config setup`, redaction.
- [ ] 5.2 GREEN/REFACTOR: modify `src/app/doctor-service.ts` and `README.md` with setup/model/doctor guidance.
- [ ] 5.3 Verify gates: `npm run openspec:validate -- provider-setup-and-model-selection`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, `npm run format`.
- [ ] 5.4 Before beta 2 controlled testing, clean/uninstall current beta from `C:\laragon\www\test-img-ia-analyzer-resizermain` to avoid stale artifact confusion.

## Done Criteria

- [ ] All spec scenarios pass; threat matrix `N/A` has no omitted applicable RED case.
- [ ] No stdout/stderr/log/project file leaks API keys; live Ollama evidence names model ids only.
