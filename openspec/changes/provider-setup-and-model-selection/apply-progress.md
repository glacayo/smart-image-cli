# Apply Progress

## Change

`provider-setup-and-model-selection`

## Slice

PR2 — model discovery and vision hints.

## Mode

Strict TDD.

## Scope

- Add OpenAI-compatible model discovery for `/v1/models` metadata.
- Normalize model list entries into stable provider-facing types.
- Add curated and metadata-derived vision hint classification.
- Keep command UX, setup wizard, doctor improvements, and beta cleanup outside PR2.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 Discovery tests | `test/adapters/vision/model-discovery.test.ts` | Unit | Existing PR1 provider transport and typed-error tests | Missing `model-discovery` module failed imports | `ModelDiscoveryClient` and normalization passed focused tests | Covered success, auth/404 typed errors, malformed JSON, metadata shapes, and connection outcomes | Collapsed client outcomes into stable union helpers |
| 2.1 Vision hint tests | `test/adapters/vision/vision-hints.test.ts` | Unit | New isolated pure-helper surface | Missing `vision-hints` module failed imports | Curated hints and metadata hint resolution passed focused tests | Covered explicit true/false/null modality metadata, curated Ollama/OpenAI-compatible IDs, unknown models, and warn-not-block behavior | Kept hints as pure functions with provider-aware inputs |
| 2.2 Production implementation | `src/adapters/vision/model-discovery.ts`, `src/adapters/vision/vision-hints.ts` | Unit-backed adapter/domain helpers | Focused discovery/hints tests plus existing provider safety tests | Failing imports and behavior expectations from RED tests | Focused discovery + hints tests passed 22/22 | Adapter safety tests passed with existing provider transport/presets coverage | Kept PR2 limited to discovery/hints; no PR3+ CLI UX added |

## Verification Evidence

| Command | Result |
|---------|--------|
| `npm test -- test/adapters/vision/model-discovery.test.ts test/adapters/vision/vision-hints.test.ts` | 22/22 passed during apply and verify |
| Provider adapter safety tests | Passed during apply and verify |
| `npm run typecheck` | Passed during apply and verify |
| `npm run lint` | Passed during apply and verify |
| `npm run openspec:validate -- provider-setup-and-model-selection` | Passed during apply and verify |
| `npm test` | 318/318 passed during apply and verify |

## Live Metadata Observation

- `GET https://ollama.com/v1/models` returned HTTP 200 with 19 models.
- `minimax-m3` was present.
- `llama3.2-vision` was absent.
- Model entries exposed `id`, `object`, `created`, and `owned_by`, but no modality/capability fields.
- Therefore PR2 keeps curated provider hints as required fallback evidence when endpoint metadata is incomplete.

## Status

PR2 implementation is ready for verification after persisting this Strict TDD evidence artifact.
