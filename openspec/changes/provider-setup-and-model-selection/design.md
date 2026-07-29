# Design: Provider Setup and Model Selection

## Technical Approach

Add a standalone `ModelDiscoveryClient` adapter (GET `{endpoint}/models`, OpenAI-compatible) for listing and connection tests; extend the shared chat transport to classify 401/403/404 into new typed errors; layer `setup` and `models` actions onto existing `configService` routing; upgrade `doctorService`'s deferred ping into real endpoint+model reachability. All calls are metadata-only — no image bytes, no spend. User-config schema already holds `activeProvider` and `providers.<id>.{apiKey,endpoint,model}`; no schema change.

## Architecture Decisions

| Decision | Choice | Tradeoff / rationale |
|---|---|---|
| Discovery home | New `ModelDiscoveryClient` adapter, not a `VisionProvider` method | Provider ctor requires `model`; setup runs before a model exists |
| 404/401 typing | Classify in `postChatCompletion` + discovery client | Single choke point: vision, ranker, discovery inherit typed errors |
| 404 disambiguation | Sniff JSON error body: model name/`model_not_found` → `ModelNotFound`; else `EndpointNotFound` | Spec: name model vs endpoint "where response allows it" |
| Vision capability | Tri-state `vision: true\|false\|null`; OpenRouter `input_modalities`; curated hints elsewhere | Warn-not-block; rejected live image probe (paid) |
| Wizard placement | `setup-service.ts` with injected `prompter`/`fetchImpl`/`userConfigPath` seams | Matches `doctorService` seam pattern; testable without TTY |
| Connection test | GET `/models` with key; optional per-preset `authCheckPath` | Rejected chat-completion probe — costs tokens |
| Key entry | TTY: masked `readline/promises` prompt; non-TTY: `--api-key` flag | Spec mandates flags; argv exposure documented |

## Data Flow (setup sequence)

    config.ts ──► configService("setup") ──► setupService
       │                                        │ TTY? prompter : flags (never prompt non-TTY)
       │                                        ├─► ModelDiscoveryClient.testConnection ─► GET /models
       │                                        ├─► listModels ─► visionHints (flag/warn)
       │                                        └─► writeUserConfig (user scope, 0600)
       └◄── CliResult ◄── emitResult (--json | non-TTY ⇒ single JSON object)

## File Changes

| File | Action | Description |
|---|---|---|
| `src/adapters/vision/provider.ts` | Modify | Kinds `Auth`, `ModelNotFound`, `EndpointNotFound` + classes naming model/endpoint |
| `src/adapters/vision/openai-compat-transport.ts` | Modify | 401/403→Auth, 404→sniffed NotFound; 429/timeout unchanged |
| `src/adapters/vision/presets.ts` | Modify | Replace `llama3.2-vision` default (live-verified); additive discovery metadata |
| `src/adapters/vision/model-discovery.ts` | Create | `listModels()`, `testConnection()`; `supported:false` when unavailable |
| `src/adapters/vision/vision-hints.ts` | Create | Modality metadata + curated hints |
| `src/cli/prompter.ts` | Create | `readline/promises` wrapper; masked secret input; TTY detection (stdin+stdout) |
| `src/app/setup-service.ts` | Create | Wizard orchestration; persists via `writeUserConfig` |
| `src/app/config-service.ts` | Modify | Route `setup`/`models`; key-set triggers connection test |
| `src/commands/config.ts` | Modify | Flags: `--provider --api-key --model --endpoint --yes` |
| `src/app/doctor-service.ts` | Modify | Endpoint + configured-model-in-list checks, masked details |
| `test/adapters`, `test/app`, `test/commands`, `test/e2e` | Create/Modify | RED-first coverage per slice |

## Interfaces / Contracts

```ts
type DiscoveredModel = { id: string; vision: boolean | null };
type ListModelsResult = { supported: true; models: DiscoveredModel[] } | { supported: false; reason: string };
class ModelDiscoveryClient {
  constructor(o: { providerId: VisionProviderId; endpoint: string; apiKey: string;
    timeoutMs?: number; fetchImpl?: typeof fetch; redactor?: SecretRedactor });
  listModels(): Promise<ListModelsResult>;
  testConnection(): Promise<void>; // throws typed VisionProviderError
}
```

JSON shapes (existing `CliResult` envelope; all `details` redacted):
- `config setup` → `details: { action, provider, endpoint, model, connectionTest: { ok }, visionHint, warnings[] }`
- `config models` → `details: { provider, endpoint, source: "discovery"|"unavailable", models[] }`
- `config set …apiKey` → existing shape + `details.connectionTest` (human mode: outcome on stderr)
- `doctor` → `checks[]` gains `provider-endpoint`, `provider-model`

Errors: Auth → `provider_auth` (4); ModelNotFound → `model_not_found` (4), names model, points to `config setup`; EndpointNotFound → `endpoint_not_found` (4); incomplete non-TTY setup → `invalid_input` (3). Existing kinds and doctor exit-5 contract unchanged.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Transport classification; discovery parsing (modality fixture, bare list, non-JSON); hints; prompt masking; setup-service branches; key-set test | vitest, `fetchImpl`/`prompter` stubs (existing seam pattern) |
| Integration | `config setup --json` non-TTY emits exactly one JSON object; `config models`; doctor unreachable-model message | `test/commands` with injected seams |
| E2E | Non-TTY setup without flags → exit 3, no hang; no key on stdout/stderr | spawned CLI, redaction asserts |

Strict TDD: RED tests precede each slice (`npm test`).

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. (HTTPS metadata calls + user-scoped config writes; secret invariants covered by tests above.)

## Migration / Rollout

No migration; schema untouched, old configs parse. Chained PRs (Feature Branch Chain, ≤400 lines each), refining proposal's 3 groups into 5 slices:

1. Typed errors in transport/provider + verified default model (~250)
2. `ModelDiscoveryClient` + vision-hints (~350)
3. `config models` + key-set connection test (~250)
4. `config setup` wizard + prompter (~400 — highest risk; sub-split non-interactive vs interactive if tests balloon)
5. Doctor reachability + docs (~250)

Each slice independently verifiable (`npm test`, typecheck, lint); rollback = revert in reverse order.

Risks: stale capability metadata → warn-not-block; divergent list endpoints → per-provider mapping + manual fallback; key leakage → reuse redactor, metadata endpoints only.

## Open Questions (live verification at implementation — none block design)

- [x] Verified vision-capable Ollama Cloud default model id → `minimax-m3` (GET `https://ollama.com/v1/models` 2026-07-29: `llama3.2-vision` absent, `minimax-m3` present; beta evidence image-accept; chat path 401 so chat not re-probed)
- [ ] Ollama `/v1/models` capability metadata? Else finalize curated list (PR2)
- [ ] OpenRouter `/models` may be public — key validation may need `authCheckPath: /key` (PR2)
- [ ] Gemini model id normalization (`models/` prefix) in listings (PR2)
