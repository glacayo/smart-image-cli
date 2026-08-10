# Exploration: replace-unsplash-with-pixabay

## Current State

`smart-image-cli` exposes external stock image sourcing exclusively through an
Unsplash integration wired across five layers:

1. **Config schema** (`src/config/user-config.ts`) — a strict Zod
   `unsplashConfigSchema = { accessKey?: string }` lives under the user-scoped
   `UserConfig.unsplash` field. The project config schema
   (`src/config/project-config.ts`) has no Unsplash field, but its
   `SECRET_KEY_PATTERN` and `assertProjectConfigHasNoSecrets` would reject any
   Unsplash key that leaked into project config.

2. **Private setup flow** (`src/app/unsplash-setup-service.ts` +
   `src/app/config-service.ts`) — `smart-img config unsplash setup` runs a
   masked interactive TTY prompt, persists the key to user-scoped config at
   mode `0600`, never echoes the value, and is non-interactive-safe (returns
   actionable, secret-free guidance in non-TTY/JSON mode). `configService`
   dispatches `action === "unsplash" && key === "setup"` to this service and
   BLOCKS generic `config set unsplash.accessKey <value>` (and the whole
   `unsplash` subtree) via `isUnsplashConfigKey` → `unsplashSetBlocked`.

3. **Credential resolver** (`src/app/runtime.ts`) —
   `resolveUnsplashCredential()` resolves env override
   (`UNSPLASH_ACCESS_KEY`) > user-config `unsplash.accessKey`, and throws
   `MissingUnsplashCredentialError` with actionable secret-free guidance.

4. **HTTP client** (`src/adapters/unsplash-client.ts`) — `UnsplashClient`
   sends `Authorization: Client-ID <key>`, searches
   `/search/photos`, tracks downloads via `links.download_location`, and
   downloads `urls.full ?? urls.regular ?? urls.raw`.

5. **Pick service** (`src/app/pick-service.ts` → `pickUnsplashService`) and
   CLI wiring (`src/commands/pick.ts`, `src/commands/config.ts`) —
   `--source unsplash` (one of `PickSource = "local" | "unsplash"`) requires
   `--query`, rejects `--orientation panorama`, searches, filters by requested
   size, dedups by download SHA against the slot's used SHAs
   (`usedShaForSlot`), downloads the first unused candidate, writes the source
   under `.img-ia/unsplash/<id>.jpg`, runs Sharp resize/crop, writes the
   produced asset under `_out`, and records usage in the SQLite index.
   `trackDownload` is called BEFORE use (Unsplash API guideline).

The output manifest for an Unsplash pick carries `photoId`, `photoUrl`,
`photographerName`, `photographerUsername`, `photographerUrl`,
`attributionText`, `attributionHtml`.

There is **no HTTP response cache anywhere** in the codebase — the only
caching is the in-process analysis-dedup `Map` in `analyze-service.ts`
(sha256-keyed, not HTTP). Pixabay's mandatory 24h response cache is a new
architectural surface.

Tests cover the Unsplash feature thoroughly:
`test/adapters/unsplash-client.test.ts`,
`test/app/{pick-unsplash-credential,unsplash-credential-precedence,unsplash-setup-service}.test.ts`,
`test/commands/config-unsplash-setup.test.ts`,
`test/config/user-config-unsplash.test.ts`, and unsplash cases inside
`test/commands/pick-semantic-options.test.ts`.

Documentation surfaces currently mentioning Unsplash:
- `README.md` (lines 73, 80–112, 141) — `--source local|unsplash`, a full
  "Picking from Unsplash" section, and a roadmap line.
- `.agents/skills/smart-image-cli/SKILL.md` — referenced via the skill.
- `docs/` contains only `docs/releases/v0.1.0-beta.2.md`; there is no
  `docs/providers/` directory yet.

The OpenSpec main specs (`openspec/specs/provider-setup/`,
`image-selection/`, `cli-runtime/`) do NOT mention Unsplash explicitly —
the external sourcing behavior is currently undocumented in specs, so this
change is mostly an ADDED-requirements + implementation change rather than a
spec REMOVED/MODIFIED of Unsplash.

## Affected Areas

- `src/adapters/unsplash-client.ts` — REMOVE; replaced by a Pixabay client.
- `src/app/unsplash-setup-service.ts` — REPLACE with a Pixabay setup service
  (same private-flow shape, new guidance URLs/messages).
- `src/app/config-service.ts` — swap `unsplash`/`Unsplash` dispatch + the
  `isUnsplashConfigKey`/`unsplashSetBlocked` guard to a Pixabay equivalent.
- `src/app/runtime.ts` — replace `resolveUnsplashCredential` +
  `MissingUnsplashCredentialError` with Pixabay equivalents; env var
  `UNSPLASH_ACCESS_KEY` → `PIXABAY_API_KEY`.
- `src/app/pick-service.ts` — replace `pickUnsplashService`, `PickSource`
  enum value `unsplash` → `pixabay`, download/source path
  `.img-ia/unsplash` → `.img-ia/pixabay`, attribution fields, and add the
  24h response cache + rate-limit handling + capability-gated high-res fields.
- `src/commands/pick.ts` — `VALID_SOURCES`, `validatePickSourceRequirements`,
  panorama rejection, `buildPickDeps` Pixabay resolver wiring.
- `src/commands/config.ts` — argument help text (action/key descriptions).
- `src/config/user-config.ts` — `unsplashConfigSchema` →
  `pixabayConfigSchema = { apiKey?: string }`; `emptyUserConfig.unsplash` →
  `.pixabay`; possibly an optional `pixabay.fullApiAccess` capability flag if
  we choose to persist discovered capability (see unresolved questions).
- `src/adapters/secret-redactor.ts` / `src/config/project-config.ts` —
  redaction patterns already cover `key`/`api_key`/query-param tokens, so the
  Pixabay `?key=...` query-string credential is redactable by existing rules.
  Must verify and add tests that a Pixabay request URL with `?key=<value>` is
  masked in error messages and never logged.
- NEW: a Pixabay response cache adapter (24h TTL, keyed by canonical request
  URL minus the key, persisted under `.img-ia/pixabay-cache/` or similar).
- `README.md`, `.agents/skills/smart-image-cli/SKILL.md` — replace Unsplash
  sections with Pixabay (BYOK, explicit source, license constraints).
- NEW: `docs/providers/pixabay.md` — canonical provider doc.
- Tests: rewrite all `*unsplash*` test files to Pixabay equivalents; add cache,
  rate-limit (429 + `X-RateLimit-*`), and capability-gating
  (`insufficient_api_access`) tests.

## Approaches

1. **In-place rename + new cache module** — Replace the Unsplash client with
   a `pixabay-client.ts`, add a `pixabay-response-cache.ts`, and rewrite the
   setup service / resolver / pick flow in place, reusing the existing private
   BYOK pattern.
   - Pros: Smallest blast radius in config/CLI wiring; reuses a proven secret
     pattern; keeps `--source` semantics consistent.
   - Cons: Pixabay's query-string key, 24h cache, rate-limit headers, and
     capability-gated fields are materially different from Unsplash and need
     new code paths, not a 1:1 rename.
   - Effort: Medium.

2. **Generic image-source provider interface** — Introduce a
   `ImageSource` interface (`search`, `download`, `attribution`) with a Pixabay
   implementation, and delete Unsplash.
   - Pros: Cleaner abstraction; future stock sources plug in easily.
   - Cons: Adds an abstraction layer for a single concrete source — speculative
     generality. Bigger change, more review surface, risks over-engineering for
     the current single-provider reality.
   - Effort: High.

3. **Keep Unsplash code as dead, add Pixabay alongside** — Not viable: the
   product decision is to REMOVE Unsplash completely, and dead code would
   retain the secret-handling surface and license obligations.
   - Effort: N/A (rejected).

### Recommendation

**Approach 1** (in-place replacement + new cache module). The existing private
BYOK setup flow, credential resolver, and `config set` guard are a strong,
security-reviewed foundation. Pixabay reuses the same human-owned-key model.
The material new work is the Pixabay-specific transport (query-string key,
24h response cache, `X-RateLimit-*` parsing + 429, capability discovery from
response fields, `insufficient_api_access` reason), not a new abstraction.
Defer a generic `ImageSource` interface until a second real source is on the
roadmap.

## Migration Behavior for Old Unsplash Config/Flags/Files

- **`userConfig.unsplash.accessKey`**: With Unsplash removed, the
  `unsplashConfigSchema` field disappears from `userConfigSchema`. A leftover
  `unsplash` key in an existing user `config.json` would be rejected by the
  `.strict()` Zod schema (`unknown key`). Decision needed: silently drop it
  on read (Zod `.passthrough()` + strip) OR fail loud with a migration
  message. Recommend fail-loud is too noisy for a key the user can't re-enter
  via the old flow; prefer a one-time migration: on `readUserConfig`, if a
  legacy `unsplash` block is present, strip it and emit a stderr note telling
  the human to run `smart-img config pixabay setup`. Persisting/migrating the
  *value* is NOT supported (different provider, different key).
- **`UNSPLASH_ACCESS_KEY` env var**: Remove honor. If still set, ignore
  silently (do not error on a deprecated env var). Document the deprecation.
- **`.img-ia/unsplash/` source folder**: Existing downloaded source files are
  keyed by Unsplash photo id. They are not reused by Pixabay. Leave them in
  place (do not delete customer data); the `.img-ia/unsplash` folder simply
  stops receiving new files. Optionally a cleanup helper, but not required.
- **`--source unsplash` flag**: Remove from `VALID_SOURCES`. A user passing
  it should get an `invalid_input` (exit 3) "unknown source" error, NOT a
  silent fallback to local.
- **Usage journal (`usage.jsonl`)**: Records store `sha256` + `slot` + `location`
  only — no provider identity, so existing Unsplash-derived usage records stay
  valid and are not migrated. Dedup-by-sha continues to work across the
  switch because Pixabay downloads produce new, distinct SHAs.
- **Indexed library / sidecars**: Unaffected — the local index is provider-
  agnostic.

## Cache Architecture

- **Mandatory**: Pixabay docs require responses to be cached for 24 hours.
  This is a hard external constraint, not optional.
- **Keying**: Cache key = canonical request URL **minus the API key** (so the
  cache is key-agnostic and never persists the secret). Store under
  `.img-ia/pixabay-cache/` (or a single SQLite/JSON file) within the project
  root, guarded by `StorageRootGuard`.
- **TTL**: 24h from response time. Store the fetched-at timestamp alongside
  the body; on read, if older than 24h, refetch.
- **Scope**: Per-project (`<root>/.img-ia/pixabay-cache/`), because the
  downstream produced assets are per-project. The cache is NOT user-scoped and
  must never contain the key.
- **Eviction**: Simplest correct approach — check TTL on read; do not proactively
  garbage-collect. Optionally prune on cache write. Keep it minimal for the
  beta line.
- **What is cached**: The full JSON search response body (hits array). The
  24h rule applies to API responses; downloaded image bytes are a separate
  flow and are stored under `.img-ia/pixabay/` by id (mirroring the existing
  `.img-ia/unsplash/` pattern).
- **Redaction**: The cache MUST NOT persist `?key=...`. Because the key is in
  the query string, the cache adapter must strip/never include it in the
  stored key or body. Add a test asserting no `key=` appears in cached files.

## Usage Dedup by Provider Asset ID Before One Download

- **Current Unsplash behavior**: dedups by **download SHA** (`sha256Bytes` of
  the downloaded bytes), checked against `usedShaForSlot`. This means it
  downloads candidates one-by-one until it finds one whose SHA is unused —
  potentially several downloads per pick.
- **Pixabay improvement opportunity**: Pixabay returns a stable numeric `id`
  per hit. We can dedup **before downloading** by mapping each Pixabay `id`
  to its previously-recorded usage SHA (stored alongside the usage event or a
  side mapping), skipping download of already-used ids. This is cheaper and
  aligns with Pixabay's "no mass downloads" rule.
- **Recommendation**: Add an `id → sha256` mapping so re-picks of the same
  slot/location skip already-used Pixabay ids without re-downloading. Keep
  the SHA-based dedup as the durable record. This is a spec-worthy behavior
  change ("Usage Dedup by Provider Asset ID").

## Redaction Because Key Lives in Query String

- Pixabay's key is a query parameter: `?key=<API_KEY>`. This is materially
  different from Unsplash's `Authorization` header — the key is much more
  likely to appear in error messages, logs, and cached URLs.
- The existing `SecretRedactor` already handles `?key=...`,
  `&key=...`, `#key=...` via `URL_QUERY_TOKEN` and the encoded-param path, so
  a Pixabay URL in an error string WILL be masked to `?key=[REDACTED]`.
  `project-config.ts` `looksLikeSecretValue` also rejects `?key=...` values.
- **Required new safeguards**:
  - The Pixabay client MUST build the request URL with the key, fetch, then
    NEVER include the original key-bearing URL in thrown error messages.
    Throw with a redacted URL or with the HTTP status + Pixabay message only.
  - The response cache MUST key on the URL without `key` and must never store
    the key. Add an explicit test.
  - `doctor`/config diagnostics MUST NOT print the request URL with the key.
  - Verify `mask()` on a real Pixabay request URL string in a unit test.

## Likely Work-Unit / PR Boundaries (delivery_strategy=auto-chain, ≤400 lines)

1. **WU-1 — Config & setup foundation (Pixabay BYOK)**: user-config schema
   (`pixabayConfigSchema`), `pixabay-setup-service.ts`, `config-service.ts`
   dispatch + `config set` guard rename, `resolvePixabayApiKey` +
   `MissingPixabayCredentialError` in `runtime.ts`, env var
   `PIXABAY_API_KEY`, migration strip of legacy `unsplash` block, exit-code +
   redaction tests. (~config + setup layer; no pick flow yet.)
2. **WU-2 — Pixabay client + 24h cache + rate limiting**:
   `pixabay-client.ts` (search, download, capability discovery, 429 +
   `X-RateLimit-*` parsing), `pixabay-response-cache.ts` (24h TTL, key-stripped
   cache key, never persists key), redaction tests for `?key=`.
   (Adapter-only, no CLI wiring.)
3. **WU-3 — Pick `--source pixabay` flow + capability gating + asset-id dedup**:
   rewrite `pickUnsplashService` → `pickPixabayService`, `PickSource` enum,
   `pick.ts` validation, `buildPickDeps`, `.img-ia/pixabay` source path,
   attribution fields, `insufficient_api_access` reason when high-res fields
   are absent and upscaling would be required, id-based dedup before download.
   (Service + CLI + tests.)
4. **WU-4 — Remove Unsplash entirely + docs/skill**: delete
   `unsplash-client.ts`, `unsplash-setup-service.ts`, and all `*unsplash*`
   tests; remove `UNSPLASH_ACCESS_KEY` honor; update README, skill, and add
   `docs/providers/pixabay.md`. (Final cleanup + docs.)

This sequencing lets each PR stay under 400 lines and keeps the Unsplash code
present (and green) until WU-4, reducing risk of a broken intermediate state.

## Decisions Confirmed

- Remove Unsplash completely; replace with Pixabay as the only external image
  source.
- BYOK: each developer configures their own Pixabay API key through the
  private persistent human-owned setup flow (`smart-img config pixabay setup`);
  agents never handle keys. No fallback to local; `--source pixabay` is
  explicit only.
- Images are downloaded locally, transformed with Sharp, stored under
  `.img-ia`/`_out`, and used inside customer websites; never redistributed as
  standalone stock assets.
- Default/normal API access uses renditions up to ~1280px (`largeImageURL`).
  High-resolution fields (`fullHDURL`, `imageURL`) are capability-gated by
  Pixabay Full API Access (not necessarily paid). The tool discovers
  capability from response fields (presence of `fullHDURL`/`imageURL`) and
  returns `insufficient_api_access` for requests it cannot satisfy without
  upscaling.
- Pixabay API key is required for every search (`key` query param).
- 24h response cache is mandatory; 100 requests/60s per key; parse
  `X-RateLimit-*` headers and handle 429.
- No mass downloads; permanent hotlinking prohibited; show Pixabay source in
  search results; `q` max 100 chars; `safesearch` on; download one selected
  candidate; standalone redistribution prohibited; third-party rights
  disclaimer surfaced.
- Documentation surfaces: README summary, canonical
  `docs/providers/pixabay.md`, project `smart-image-cli` skill.
- Preflight: `delivery_strategy=auto-chain`, `review_budget_lines=400`,
  strict TDD.

## Unresolved Product Questions

1. **Legacy `unsplash` config migration**: Should `readUserConfig` silently
   strip a leftover `unsplash` block (with a stderr note), or fail loud?
   Recommendation: strip + stderr note. Needs confirmation.
2. **Capability persistence**: When Pixabay returns `fullHDURL`/`imageURL`
   (Full API Access), should we persist a `pixabay.fullApiAccess: true` flag
   in user config to avoid re-probing, or always discover from the response?
   Recommendation: always discover from response fields (no persisted flag) —
   simpler and avoids stale state. Needs confirmation.
3. **Default rendition**: "up to ~1280px" maps to `largeImageURL` (max
   1280px). When a requested `--width`/`--height` exceeds 1280px AND the
   account has Full API Access, do we fetch `fullHDURL` (1920px) /
   `imageURL` (original)? Recommendation: yes, pick the smallest rendition
   that satisfies the request without upscaling; return
   `insufficient_api_access` if no eligible rendition exists. Needs
   confirmation of the selection ladder.
4. **`safesearch` default**: Should `safesearch=true` be hardcoded, or
   configurable? Recommendation: hardcode `safesearch=true` (product safe
   default) with no flag for the beta line. Needs confirmation.
5. **`image_type` default**: Default to `photo` (excluding
   illustrations/vectors) or `all`? Recommendation: `photo` for website image
   use cases; add `--image-type` later if needed. Needs confirmation.
6. **Cache location & format**: `.img-ia/pixabay-cache/` as per-file JSON, or
   a single SQLite/JSON store? Recommendation: single JSON map file
   (`pixabay-cache.json`) for simplicity in the beta. Needs confirmation.
7. **Env var name**: `PIXABAY_API_KEY` (confirmed assumption) — confirm exact
   spelling and that it is the only honored env override.

## Recommended Capability / Spec Boundaries

- **New spec domain**: `image-source-pixabay` (or extend `image-selection`).
  Recommend a new `openspec/changes/replace-unsplash-with-pixabay/specs/image-source-pixabay/spec.md`
  delta with ADDED requirements, and leave `image-selection` untouched except
  for the `PickSource` enum change (MODIFIED requirement on
  "Constraint-Based Matching" or a new "External Image Source" requirement).
- **Spec requirements to ADD** (Pixabay-specific, RFC 2119):
  - **Pixabay BYOK Setup**: `smart-img config pixabay setup` private masked
    TTY prompt, mode 0600 user-scoped persistence, non-TTY actionable
    secret-free guidance, blocks generic `config set pixabay.apiKey`.
  - **Pixabay API Key Required**: every search requires `key`; missing key
    returns `missing_pixabay_credential` with actionable guidance; env
    override `PIXABAY_API_KEY` honored as operator runtime override only.
  - **24h Response Cache**: search responses MUST be cached for 24h, keyed
    by the request URL without `key`, stored per-project under `.img-ia`,
    never persisting the key.
  - **Rate Limit Compliance**: parse `X-RateLimit-Limit/Remaining/Reset`,
    handle HTTP 429 with a structured `rate_limited` reason and the
    provider-error exit code; do not retry storms.
  - **Capability Discovery from Response Fields**: high-res fields
    (`fullHDURL`, `imageURL`) are discovered from the response, not assumed;
    when a request needs a rendition the account cannot access and
    upscaling would be required, return `insufficient_api_access` (no
    upscaling, consistent with the existing no-upscale pick rule).
  - **No Mass Download / One Selected Candidate**: download only the
    selected candidate; do not bulk-download hits.
  - **Pixabay Source Attribution in Results**: search/pick results MUST
    surface the Pixabay source (pageURL / user / pageURL) per Pixabay's
    "show where images are from" requirement.
  - **Standalone Redistribution Prohibited Disclaimer**: docs/skill MUST
    surface the Pixabay license standalone-redistribution prohibition and
    third-party-rights disclaimer.
  - **Query and Safesearch Constraints**: `q` truncated/rejected over 100
    chars; `safesearch=true` default; `image_type=photo` default.
  - **Usage Dedup by Provider Asset ID**: skip downloading Pixabay ids
    already used for the same slot+location before fetching bytes, while
    keeping the durable SHA-based usage record.
- **Spec requirements to MODIFY in `image-selection`**: the `PickSource`
  surface changes from `local|unsplash` to `local|pixabay`; the
  "Fail With Close Alternatives" / "No Upscaling" rules extend to the
  Pixabay `insufficient_api_access` case.
- **Spec requirements NOT to add**: a generic `ImageSource` interface (defer).

## Likely Changed Files

- `src/config/user-config.ts` — `pixabayConfigSchema`, `emptyUserConfig.pixabay`.
- `src/app/pixabay-setup-service.ts` (new, replaces
  `unsplash-setup-service.ts`).
- `src/app/config-service.ts` — Pixabay dispatch + `config set` guard.
- `src/app/runtime.ts` — `resolvePixabayApiKey`,
  `MissingPixabayCredentialError`.
- `src/adapters/pixabay-client.ts` (new, replaces `unsplash-client.ts`).
- `src/adapters/pixabay-response-cache.ts` (new).
- `src/app/pick-service.ts` — `pickPixabayService`, `PickSource`,
  `buildPickDeps` wiring, `.img-ia/pixabay` source path.
- `src/commands/pick.ts` — `VALID_SOURCES`, validation, panorama handling.
- `src/commands/config.ts` — argument help text.
- `src/adapters/secret-redactor.ts` — likely no change (already covers
  `?key=`), but add tests.
- `src/config/project-config.ts` — likely no change, add tests for `?key=`.
- `README.md`, `.agents/skills/smart-image-cli/SKILL.md`,
  `docs/providers/pixabay.md` (new).
- Tests: delete `test/adapters/unsplash-client.test.ts`,
  `test/app/unsplash-*.test.ts`, `test/commands/config-unsplash-setup.test.ts`,
  `test/config/user-config-unsplash.test.ts`; add Pixabay equivalents + cache,
  rate-limit, capability, redaction tests.

## Risks

- **Key leakage via query string**: Unlike Unsplash's header auth, the Pixabay
  key sits in the URL and can leak into error messages, logs, and the cache if
  not carefully stripped. Mitigation: redaction tests, key-stripped cache key,
  never log the original request URL.
- **24h cache correctness**: An incorrect TTL or a cache that persists the key
  violates Pixabay's terms and leaks the secret. Mitigation: explicit
  no-key-in-cache tests, timestamp-based TTL.
- **Capability gating false negatives**: If the tool fails to detect
  `fullHDURL`/`imageURL` presence, it may either over-fetch (license risk) or
  under-serve (`insufficient_api_access` when access exists). Mitigation:
  discover from response fields, not config; test both present/absent.
- **Breaking existing Unsplash users**: Anyone with `unsplash.accessKey` in
  their user config or the `UNSPLASH_ACCESS_KEY` env var set will have a
  behavior change. Mitigation: graceful strip + stderr migration note; clear
  docs.
- **Rate-limit storms from the dedup loop**: The current Unsplash flow
  downloads candidates until an unused one is found; with Pixabay's 100/60s
  limit and no-mass-download rule, this pattern must change to id-based dedup
  before download. Mitigation: WU-3 explicitly addresses this.
- **Strict TDD + 400-line PR budget**: The change is large (client + cache +
  setup + pick + docs + tests). Risk of WU-4 (Unsplash removal) being oversized
  if WUs 1–3 leave dead Unsplash code. Mitigation: the proposed 4-WU chain
  sequences removal last so each PR stays focused.
- **Spec scope creep**: Temptation to add a generic `ImageSource` interface
  inflates the change. Mitigation: defer; one concrete source only.