# Proposal: Provider Setup and Model Selection

## Intent

Beta `v0.1.0-beta.1` (real customer folder) exposed onboarding blockers: default `llama3.2-vision` 404s on `img analyze`; users hand-research models (GLM-5.2: no image input; `minimax-m3`: images accepted, then `MalformedOutputProviderError`). Key storage/redaction already work. Add guided setup: connection test, model listing, selection, image-capability guidance.

Stack: Node >=22, TypeScript 5.7 ESM, Commander/Zod, `node:readline/promises`; no new dependencies.

## Scope

### In Scope

- `listModels()` + connection/key test per provider (ollama, openrouter, gemini), metadata endpoints only; typed model-not-found error (404 → actionable, exit 4).
- `img config setup`: provider → key → test → model list → choose → persist; flags + `--json` for non-TTY agents.
- Listing flags vision-capable models; warn otherwise; `doctor` checks model reachability.
- Replace broken `llama3.2-vision` default with a verified vision-capable model.

### Out of Scope

- New providers; OS keychain.
- Prompt/parser hardening for weak-JSON models — follow-up if beta 2 reproduces `MalformedOutputProviderError`.
- Beta 1 cleanup — deferred until before beta 2.
- Paid image-probe detection.

## Capabilities

### New Capabilities

- `provider-setup`: guided onboarding — connection test, model discovery, selection, vision-capability guidance.

### Modified Capabilities

- `ai-provider`: model-discovery/connection-test contract, model-not-found typed error, verified vision-capable defaults.
- `cli-runtime`: `config`/`doctor` extended with setup flow, model listing, key-set connection test.

## Approach

Extend the OpenAI-compatible adapter with `GET /models` discovery and key validation; curate per-provider vision hints (OpenRouter modality metadata; allowlists elsewhere). Wizard layers onto `config-service`, preserving JSON/non-TTY contract, exit codes, redaction.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/adapters/vision/` | Modified | `listModels`, connection test, typed 404, verified defaults |
| `src/commands/config.ts`, `src/app/config-service.ts`, `src/app/doctor-service.ts` | Modified | Setup flow, listing, key-set test, reachability |
| `src/config/user-config.ts`, `test/` | Modified/New | Additive fields; TDD coverage |

## Rollout (chained PRs, 400-line budget)

1. Adapter: `listModels`, connection test, typed 404, default fix.
2. CLI: setup flow, model listing, key-set test.
3. Capability guidance, doctor, docs.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Model-list endpoints differ | Med | Per-provider mapping; manual fallback |
| Capability metadata stale | Med | Warn-not-block; curated hints |
| Key leakage | Low | Reuse redactor; metadata endpoints only |

## Rollback Plan

Revert PRs in reverse order. Schema changes additive — old configs keep parsing. Preset default reverts with PR 1. No migrations.

## Dependencies

- Reachable provider metadata endpoints (`/v1/models` equivalents).
- Verified image-capable Ollama Cloud model id (validated at implementation).

## Success Criteria

- [ ] `img config setup` completes provider+key+model with passing connection test.
- [ ] Invalid key/model → typed actionable error, exit 4.
- [ ] Ollama Cloud default no longer 404s on `analyze`.
- [ ] No secrets on stdout/stderr/logs.
