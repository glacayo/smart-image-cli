# Design: Replace Unsplash with Pixabay

## Technical Approach

In-place replacement (proposal Approach 1). No `ImageSource` abstraction. One pure-domain module
(bands + ladder), three adapters (client, cache, used-id index); everything else reuses existing
seams: `StorageRootGuard`, `defaultSecretRedactor`, `SharpProcessor`, `planResize`, `appendUsage`,
the private BYOK prompt. Unsplash is deleted only after Pixabay is green.

## Architecture Decisions

| # | Choice | Rejected | Rationale |
|---|---|---|---|
| D1 | Bands + ladder in `src/domain/pixabay-renditions.ts`, pure | Inline in pick-service | RED-testable, no HTTP/FS |
| D2 | `square` = `0.9 ≤ w/h ≤ 1.1`; `panorama` = `w/h ≥ 2.0`; `portrait` `<0.9`; `landscape` `1.1<r<2.0` | 16:9 as panorama; ±5% square | `2.0` is the smallest cut keeping 16:9 (1.778) and 1.85:1 cinema OUT of panorama — else every hero is a panorama. ±10% admits 1:1 crops, rejects 5:4 (1.25) and 4:5 (0.8) |
| D3 | Bands partition all four orientations; API `orientation` is only a pre-filter (`landscape`+`panorama`→`horizontal`, `portrait`→`vertical`, `square`→omitted) | Local filter for square/panorama only | Mirrors `explainCandidate` exact-equality orientation; stops `landscape` returning 3:1 banners |
| D4 | `.img-ia/pixabay/used-ids.jsonl` is an **index** (`id`→`sha`), not truth. Used = mapped sha ∈ `usage.jsonl` for that slot+location | `providerId` on `UsageEvent` + SQLite migration | No migration on the shared index; orphan/torn lines self-heal |
| D5 | Source < request ⇒ `no_candidate` (2). Source OK but tier-capped ⇒ success + `resolution_cap` warning | Always warn; always fail | Keeps "No Upscaling": a cap is a tier fact, not an unfit image |
| D6 | Cache = one JSON file per canonical key, `tmp`+`rename`, `0600` | Single map file; SQLite | No read-modify-write race; corruption is per-key |
| D7 | Full access discovered per response (`fullHDURL`/`imageURL` presence) | Persist `fullApiAccess` | No stale capability state |
| D8 | Unsplash removed in the last slices | Remove first | Every intermediate PR compiles and stays green |

## Data Flow

    pick --source pixabay        (no cross-source fallback on any failure)
     ├ validate source enum, composed q ≤ 100 ......... exit 3, no request
     ├ resolvePixabayApiKey: PIXABAY_API_KEY > user cfg  exit 4, no request
     ├ canonicalKey = URL minus `key`, params sorted
     │   hit <24h ─yes────────────┐   read/parse/write failure ⇒ live fetch, never fatal
     │   no ↓                     │
     │  GET /api/?key=… ─429⇒rate_limited; parse X-RateLimit-*; atomic write
     ├────────────────────────────► hits[]
     ├ aspectBand + source-dim filter ................. domain
     ├ drop ids ∈ used-ids ∩ usage.jsonl .............. zero bytes fetched
     ├ selectRendition ⇒ url, dims, warning?
     ├ ONE download → .img-ia/pixabay/<id>.jpg (guarded, 0600)
     ├ planResize → Sharp.produce → _out/…
     ├ appendUsage ── fail ⇒ rm(_out) + usage_failed (5)
     └ append id→sha → manifest + warnings[]

## File Changes

| File | Action | Description |
|---|---|---|
| `src/domain/pixabay-renditions.ts` | Create | `aspectBand`, `orientationParam`, `selectRendition` |
| `src/adapters/pixabay-client.ts` | Create | `GET /api/`, fixed `image_type=photo`, `safesearch` default `true`, rate headers, 429, redacted errors |
| `src/adapters/pixabay-response-cache.ts` | Create | Key-stripped canonical key, 24h TTL, atomic write |
| `src/adapters/pixabay-used-ids.ts` | Create | Append/read `id`→`sha` index |
| `src/app/pixabay-setup-service.ts` | Create | Masked TTY prompt, `0600`, non-TTY rejected |
| `src/config/user-config.ts` | Modify | `pixabayConfigSchema`; legacy `unsplash` stripped on read |
| `src/app/runtime.ts` | Modify | `resolvePixabayApiKey`, `MissingPixabayCredentialError` |
| `src/app/config-service.ts` | Modify | `pixabay setup` dispatch; `config set pixabay.*` blocked |
| `src/app/pick-service.ts` | Modify | `pickPixabayService`, `PickSource = local\|pixabay` |
| `src/commands/pick.ts` | Modify | `VALID_SOURCES`, `--safesearch`, composed-query length |
| `README.md`, `.agents/skills/smart-image-cli/SKILL.md` | Modify | Pixabay replaces Unsplash |
| `docs/providers/pixabay.md` | Create | Canonical provider doc |
| `unsplash-client.ts`, `unsplash-setup-service.ts`, `test/**/*unsplash*` | Delete | Never shipped |

## Interfaces / Contracts

```ts
export const SQUARE_MIN = 0.9, SQUARE_MAX = 1.1, PANORAMA_MIN = 2.0;
export function aspectBand(width: number, height: number): Orientation;

// Rungs ascending: webformatURL 640, largeImageURL 1280, fullHDURL 1920, imageURL = source.
// Smallest rung meeting the request; else largest available + cap warning. Never enlarge.
export type RenditionChoice =
  | { ok: true; url: string; dims: Dims; warning?: ResolutionCapWarning }
  | { ok: false; reason: "source_too_small" };
export function selectRendition(hit: PixabayHit, req: Partial<Dims>): RenditionChoice;

export type ResolutionCapWarning = { code: "resolution_cap"; requested: Dims; delivered: Dims;
  maxRenditionEdge: number; cause: "full_api_access_unavailable" };
export class PixabayClientError extends Error {
  kind: "network" | "http" | "invalid_json" | "rate_limited"; status?: number;
  rateLimit?: { limit: number; remaining: number; resetSeconds: number };
}
```

Manifest adds `source:"pixabay"`, `pixabayId`, `pageURL`, `contributor`,
`license:"Pixabay Content License"`, a combined-work-only / no-standalone-redistribution /
third-party-rights `disclaimer`, and `warnings[]`.

## Errors, Exits, Observability

| Reason | Exit | Trigger |
|---|---|---|
| `invalid_input` | 3 | unknown `--source` (incl. `unsplash`), missing `--query`, composed `q` > 100, non-TTY setup |
| `missing_pixabay_credential` | 3 | `config set pixabay.*` blocked — redirect to the setup command |
| `missing_pixabay_credential` | 4 | `pick`: no env, no config key — before any HTTP |
| `rate_limited` | 4 | HTTP 429, no automatic retry |
| `provider_error` | 4 | network / HTTP / invalid JSON, message via `mask()` |
| `no_candidate` | 2 | nothing survives band/size/dedup, or source < request |
| `usage_failed` | 5 | durable usage write failed after Sharp; `_out` deleted |

Observable, secret-free: `cache: hit\|miss\|stale`, `rateLimit{limit,remaining,resetSeconds}`,
`renditionField`, `candidatesFiltered`, `warnings[]`.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. The real surface is credential-in-URL leakage: the client never puts
the key-bearing URL in a thrown message (status + Pixabay message only); the cache deletes `key`
before hashing and asserts its absence before writing; project config, `config list`, and `doctor`
never receive the value. `SECRET_URL_PARAM_NAMES` already covers `key`, so `mask()` is the last
line of defence, not the first. All `.img-ia` writes go through `StorageRootGuard` at `0600`.

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit domain | Bands at 0.899 / 0.9 / 1.1 / 1.101 / 1.778 / 1.999 / 2.0; rung selection; `source_too_small` | Table-driven |
| Unit adapters | Canonical key excludes `key`; TTL 24h; corrupt cache ⇒ live fetch; atomic rename; 429; `X-RateLimit-*`; key-free errors | Injected `fetch`, tmp root |
| Unit app | Env > config precedence; credential check before HTTP; `config set pixabay.*` blocked; non-TTY setup; legacy strip | Injected prompter |
| Integration | Exactly one download; used id skipped without fetch; `usage_failed` deletes `_out`; license fields | Stub client, real FS |
| E2E | `--source unsplash` ⇒ exit 3; capped request ⇒ exit 0 + warning | CLI spawn |

All written RED first (`strict_tdd: true`, `npm test`).

## Migration / Rollout

No data migration. A legacy `unsplash` config block is stripped on read with a stderr note pointing
at `smart-img config pixabay setup`; the value is never migrated. `UNSPLASH_ACCESS_KEY` is ignored
silently. Existing `.img-ia/unsplash/` files and `usage.jsonl` records stay valid. Rollback = revert
one slice's merge commit; slices 1–4 are additive and inert until slice 5 wires them.

## Work Units (auto-chain, review_budget_lines = 400)

| # | Slice | Est. | Verified by |
|---|---|---|---|
| 1 | Domain: bands + rendition ladder | ~280 | Pure unit tests |
| 2 | BYOK config, setup service, resolver | ~330 | Config/setup tests |
| 3 | `pixabay-client` + rate limits + redaction | ~380 | Injected-fetch tests |
| 4 | `pixabay-response-cache` (24h, atomic) | ~300 | Tmp-root cache tests |
| 5 | Pick flow + used-ids + CLI wiring | ~400 ⚠ | Integration + E2E |
| 6a | Delete `unsplash-client` + test | ~295 | Suite green |
| 6b | Delete setup service + config guard + tests | ~400 ⚠ | Suite green |
| 6c | Delete resolver + `unsplashConfigSchema` + tests | ~290 | Suite green |
| 7 | README + `docs/providers/pixabay.md` + skill | ~260 | Docs review |

**Size exception risk**: slices 5 and 6b sit at budget. Slice 5 splits at the client/flow seam
(ladder wiring vs. dedup+rollback) if it overruns. Removal is split into three layer-scoped
deletions instead of one ~1,120-line drop; a single atomic removal would need an explicit
`size:exception`, justified because deleting an unshipped feature carries near-zero review risk
once 1–5 are green.

**Spec-conformance caveat**: `--source unsplash` returns exit 3 only from slice 6c onward. Slices
1–5 keep both sources registered so every PR compiles.

## Open Questions

- [ ] None blocking. Exploration questions 1–7 are resolved by D2, D4–D7 and Migration.
