# Apply Progress: replace-unsplash-with-pixabay

## Mode

Strict TDD | artifact_store=openspec | delivery_strategy=auto-chain | chain=feature-branch-chain

## Branch

- Tracker: `feature/replace-unsplash-with-pixabay` (from `main` @ 8ab9972)
- WU1 head: `feat/pixabay-renditions` @ `eda45b0`
- WU2 head: `feat/pixabay-byok-config` @ `157ccdd`
- WU3 head: `feat/pixabay-client` @ `128f478` (committed; Gentle AI approved)
- WU4 head: `feat/pixabay-response-cache` @ `9936271`
- WU5a head: `feat/pixabay-pick-cli-contract` @ `77b5728` (committed)
- WU5b1 head: `feat/pixabay-used-ids` @ `cb5faeb` (committed)
- WU5b2 head: `feat/pixabay-candidate-acquisition` @ `dccaded`
- WU5b3 head: `feat/pixabay-pick-transaction` @ `243774d`
- WU6a1 head: `feat/remove-unsplash-client` @ `59c8707` (decouple pick from Unsplash client)
- WU6a2 head: `feat/remove-unsplash-client` @ `f4e9381` (orphaned client deleted)
- WU6b1 head: `feat/remove-unsplash-setup-service` @ `1153d29` (setup dispatch/help removal; service retained)
- WU6b2 head: `feat/remove-unsplash-runtime` @ `7e54d52` (setup service deleted)
- WU6c1 head: `feat/remove-unsplash-cli-source` @ `3cf91f2` (runtime/schema strip committed)
- WU6c2 head: `feat/remove-unsplash-cli-source` @ `6be2787` (CLI enum + e2e rejection committed)
- WU6c3a head: `feat/remove-unsplash-pick-service-core` @ `9ce6678` (obsolete Unsplash pick tests removed)
- WU6c3b head: `feat/remove-unsplash-pick-service-core` @ `baa0c6c` (pick-service Unsplash teardown + static guard)
- WU7 branch: `docs/pixabay-provider` from WU6c3b `baa0c6c` — documentation only, **not committed**
- Remediation 5.4 head: `fix/exif-test-stability` @ `b0ca039` (CRIT-004 EXIF fixture)
- Remediation 5.5 head: `fix/pixabay-success-test-stability` @ `e79db70` (CRIT-001 recurrence success-test split)
- Remediation 5.6: same branch/HEAD `fix/pixabay-success-test-stability` @ `e79db70` — OpenSpec delta header only (CRIT-005; uncommitted artifact fix)
- PR targeting (when opened): tracker/prior ← child; do not target `main` directly

## Completed Work Units

### WU1 — Domain bands + rendition ladder

- [x] 1.1 Create pure `src/domain/pixabay-renditions.ts` + unit tests

#### Files

| File | Action |
|------|--------|
| `src/domain/pixabay-renditions.ts` | Created — `aspectBand`, `orientationParam`, `selectRendition` |
| `test/domain/pixabay-renditions.test.ts` | Created — band boundaries, API orientation map, ladder |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `test/domain/pixabay-renditions.test.ts` | Unit | N/A (new) | ✅ Written — suite failed: missing module | ✅ 21/21 passed | ✅ 11 band cases + 5 ladder table + source_too_small + cap warning + no-enlarge | ✅ Compact pure helpers (`rung`, table-driven tests); 308 authored lines |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/domain/pixabay-renditions.test.ts` → exit 0, **21 passed** (1 file) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Runtime harness | **N/A** — pure domain module; no CLI/HTTP/FS boundary in WU1 |
| Rollback boundary | Delete `src/domain/pixabay-renditions.ts` and `test/domain/pixabay-renditions.test.ts` (or revert WU1 commit). No other production wiring. |
| Authored line count | **308** (src 165 + test 143) — under 400 budget (forecast ~280) |

#### Behaviors delivered

- `aspectBand`: portrait / square / landscape / panorama per D2 bounds (0.9 / 1.1 / 2.0)
- `orientationParam`: landscape+panorama→`horizontal`, portrait→`vertical`, square omitted
- `selectRendition`: smallest rung web→large→fullHD→source; `source_too_small`; free-tier `resolution_cap` warning; never enlarge

### WU2 — BYOK config / setup / resolver

- [x] 1.2 Pixabay schema, private setup, credential resolver, config-set guard

#### Files

| File | Action |
|------|--------|
| `src/config/user-config.ts` | Modified — `pixabayConfigSchema`, `pixabay` on user config, `UserConfigInput` |
| `src/app/pixabay-setup-service.ts` | Created — masked TTY setup, non-TTY reject, 0600 via `writeUserConfig` |
| `src/app/runtime.ts` | Modified — `resolvePixabayApiKey`, `MissingPixabayCredentialError`, `ResolvedPixabayCredential` |
| `src/app/config-service.ts` | Modified — `pixabay setup` dispatch, `pixabaySetBlocked` / `isPixabayConfigKey` |
| `src/commands/config.ts` | Modified — help text includes pixabay setup |
| `test/app/pixabay-setup-service.test.ts` | Created — non-TTY, interactive, set-block, list redaction |
| `test/app/pixabay-credential-precedence.test.ts` | Created — env>config, missing, doctor key-free |
| `test/commands/config-pixabay-setup.test.ts` | Created — CLI routing, no secret flag |
| `test/config/user-config-unsplash.test.ts` | Modified — `emptyUserConfig` includes `pixabay: {}` |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.2 | `test/app/pixabay-setup-service.test.ts` + `test/app/pixabay-credential-precedence.test.ts` + `test/commands/config-pixabay-setup.test.ts` | Unit/App | ✅ 25/25 unsplash+user-config baseline | ✅ Written — missing module / missing exports / schema reject | ✅ Focused 3 files pass; full related 26/26 | ✅ non-TTY + interactive + set-block + env/config/missing + doctor + CLI routing | ✅ Compact setup service + densified tests; commit raw later measured **430** |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/app/pixabay-setup-service.test.ts test/app/pixabay-credential-precedence.test.ts test/commands/config-pixabay-setup.test.ts` → exit 0, **3 passed** (3 files; dense multi-assert cases) |
| Related regression | same + unsplash setup/cred + user-config-unsplash → exit 0, **26 passed** (6 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Runtime harness | **N/A** — TTY/private setup and credential resolution covered via injected prompter/isTty/env; no live Pixabay HTTP in WU2 |
| Rollback boundary | Revert WU2 commit `157ccdd` on `feat/pixabay-byok-config`. Does not touch WU1 domain files or Unsplash removal. |
| Authored line count | **430** actual raw (`git show --numstat 157ccdd`; prior claim 398 was wrong). Maintainer-approved **`size:exception` scoped to commit `157ccdd` / WU2 only** — do not rewrite history; later budgets stay hard 400. |
| Commit status | **Committed** @ `157ccdd` after Gentle AI 2.3.0 approved receipt |

#### Behaviors delivered

- `pixabayConfigSchema` / `pixabay.apiKey` on user-scoped config (mode 0600 via existing `writeUserConfig`)
- `smart-img config pixabay setup` private masked prompt; non-TTY → exit 3 + `missing_pixabay_credential` guidance
- `config set pixabay.*` blocked (user + project) with setup redirect
- `resolvePixabayApiKey`: `PIXABAY_API_KEY` env > user-config; `MissingPixabayCredentialError`
- config list / doctor output stay key-free (`apiKey` redacted by existing secret redactor)

### WU3 — Pixabay HTTP client

- [x] 2.1 `PixabayClient` + `PixabayClientError` (`search`, `download`) with rate-limit + secret-free errors

#### Files

| File | Action |
|------|--------|
| `src/adapters/pixabay-client.ts` | Created — `PixabayClient`, `PixabayClientError`, `search`, `download`, rate headers, key-free errors |
| `test/adapters/pixabay-client.test.ts` | Created — query shape/`?key=`, 429 no-retry, secret-free taxonomy, download |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `test/adapters/pixabay-client.test.ts` | Unit | ✅ 1/1 unsplash-client baseline | ✅ Written — missing module | ✅ 3/3 dense cases passed (then held through refactor) | ✅ photo+key+orientation+rate headers; free-tier parse; safesearch=false; 429 once; http/network/invalid_json secret-free; download ok+fail; empty key | ✅ Shared `fetchResponse`/`throwIfHttpFailed`/`clientError`; densified to **386** authored lines |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/adapters/pixabay-client.test.ts` → exit 0, **3 passed** (1 file; dense multi-assert cases) |
| Related regression | `npx vitest run test/adapters/unsplash-client.test.ts test/adapters/pixabay-client.test.ts` → exit 0, **8 passed** (2 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Runtime harness | **N/A** — injected `fetch` only; no live Pixabay HTTP in WU3 (cache/CLI wiring are WU4+) |
| Rollback boundary | Delete `src/adapters/pixabay-client.ts` + `test/adapters/pixabay-client.test.ts` (or drop staged candidate / revert WU3 commit). No pick/config/cache wiring. |
| Authored line count | **386** (src 221 + test 165) — under 400 budget (forecast ~380) |
| Commit status | **Committed** @ `128f478` after Gentle AI approved receipt |

#### Behaviors delivered

- `GET https://pixabay.com/api/` with required `key`, fixed `image_type=photo`, `safesearch` default `true`, optional API `orientation` (`horizontal`/`vertical`)
- Parses hits into `PixabaySearchHit` (domain `PixabayHit` + `pageURL`/`user`); drops incomplete hits; preserves optional `fullHDURL`/`imageURL`
- Parses `X-RateLimit-Limit/Remaining/Reset` onto search results and 429 errors
- HTTP 429 → `PixabayClientError` kind `rate_limited`, **no automatic retry**
- Error taxonomy: `network` \| `http` \| `invalid_json` \| `rate_limited`; messages are status + Pixabay body text only; never include key-bearing request URL; strip `key=` / key URLs from provider text; never attach fetch cause (URL leakage)
- `download(url)` returns image bytes; same secret-free HTTP failure path
- Empty/whitespace `apiKey` rejected at construction with setup guidance

### WU4 — Pixabay response cache

- [x] 2.2 `PixabayResponseCache` + `canonicalKey` (24h TTL, key-stripped, atomic 0600)

#### Files

| File | Action |
|------|--------|
| `src/adapters/pixabay-response-cache.ts` | Created — `canonicalKey`, `PixabayResponseCache` read/write, TTL, key-free guards |
| `test/adapters/pixabay-response-cache.test.ts` | Created — key-free identity, fresh/stale/corrupt, atomic 0600, collision |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.2 | `test/adapters/pixabay-response-cache.test.ts` | Unit | N/A (new adapter; related clients green baseline later) | ✅ Written — suite failed: missing module | ✅ 3/3 dense cases passed | ✅ strip+sort identity; fresh hit / TTL boundary / stale; corrupt+missing fields→miss; key payload rejected; atomic no-tmp; IO fail→miss/false; shared hash path / no collision | ✅ Dropped unused stub; held **326** authored lines |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/adapters/pixabay-response-cache.test.ts` → exit 0, **3 passed** (1 file; dense multi-assert cases) |
| Related regression | `npx vitest run test/adapters/pixabay-response-cache.test.ts test/adapters/pixabay-client.test.ts test/adapters/unsplash-client.test.ts` → exit 0, **7 passed** (3 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Runtime harness | **N/A** — tmp-root FS only; no live Pixabay HTTP; pick/client wiring is WU5a+ |
| Rollback boundary | Delete `src/adapters/pixabay-response-cache.ts` + `test/adapters/pixabay-response-cache.test.ts` (or drop staged candidate / revert WU4 commit). No pick/client wiring. |
| Authored line count | **326** (src 165 + test 161) — under 400 budget (forecast ~300) |
| Commit status | **Not committed** — WU4 code staged for Gentle AI review; OpenSpec artifacts remain untracked |

#### Behaviors delivered

- `canonicalKey(url)`: drops `key` query param (case-insensitive), sorts remaining params, stable key-free identity
- Cache path: `.img-ia/pixabay/cache/<sha256(identity)>.json` — hash filename never embeds key or raw URL secrets
- Entry shape: `{ cachedAt, identity, payload }`; TTL default 24h (`PIXABAY_CACHE_TTL_MS`); injectable `now`
- `read` → `hit` \| `miss` \| `stale`; corrupt/malformed/identity mismatch/key-in-body → `miss` (never throws)
- `write` → atomic O_EXCL tmp + fsync + rename + chmod 0600; returns `false` on IO failure or key-material rejection (never throws, never persists key)
- Pre-write asserts key absence in identity, payload JSON, and serialized body

### WU5a — Pick CLI contract (source/safesearch/q length)

- [x] 3.1 Explicit `--source pixabay`, `--safesearch`, composed q ≤ 100, no local fallback wiring

#### Files

| File | Action |
|------|--------|
| `src/app/pick-service.ts` | Modified — `PickSource` += `pixabay`, `safeSearch`, `PIXABAY_MAX_QUERY_LENGTH`, `composePixabayQuery`, fail-closed pixabay branch (no local fallback; full flow WU5b) |
| `src/commands/pick.ts` | Modified — `VALID_SOURCES`, `--safesearch`, pixabay query/composed-q validation, parse defaults, `buildPickDeps` empty for pixabay |
| `test/commands/pick-semantic-options.test.ts` | Modified — RED→GREEN CLI contract cases (explicit source, no-fallback deps, q>100, safesearch, panorama, no key flags) |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `test/commands/pick-semantic-options.test.ts` | Unit/CLI | ✅ 11/11 baseline | ✅ Written — source rejected / unknown `--safesearch` / local ranker wired | ✅ 15/15 passed | ✅ explicit+default safesearch+orientation map; missing q / q>100 / composed>100 / bad safesearch / exact-100; panorama+safesearch=false+no key flags; buildPickDeps empty | ✅ Compact compose helper + fail-closed branch; **266** authored lines |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/commands/pick-semantic-options.test.ts` → exit 0, **15 passed** (1 file) |
| Related regression | `npx vitest run test/commands/pick-semantic-options.test.ts test/commands/numeric-validation.test.ts test/app/pick-unsplash-credential.test.ts test/app/pick-semantic-service.test.ts` → exit 0, **57 passed** (4 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Runtime harness | **N/A** — CLI contract via Commander + stubbed `pickService`; no live Pixabay HTTP; full pick/download is WU5b |
| Rollback boundary | Revert staged diffs on `src/commands/pick.ts`, `src/app/pick-service.ts`, `test/commands/pick-semantic-options.test.ts` (or drop branch). Does not touch cache/client/download/used-ids. |
| Authored line count | **266** (add 258 + del 8) — under 400 budget (forecast ~210) |
| Commit status | **Not committed** — WU5a code staged for Gentle AI review; OpenSpec artifacts remain untracked |

#### Behaviors delivered

- `--source pixabay` accepted alongside preserved `local`/`unsplash` (removal is WU6*)
- `--safesearch true|false` (default `true` when source is pixabay); invalid value → exit 3
- Missing `--query` for pixabay → exit 3, no service call
- Composed `q` (query + unique categories) > 100 → exit 3 before any request/service
- Exact 100-char query accepted
- Pixabay allows `--orientation panorama` (local band filter later); landscape maps via domain `orientationParam` → `horizontal`
- `buildPickDeps` for pixabay returns `{}` (no local ranker/index — SEL-1 no silent fallback)
- `pickService` fail-closes on `source === "pixabay"` until WU5b wires search/download (never falls through to local index)
- No API key / access key CLI flags

#### Correction R3-001 (bounded, post-review)

Finding: CLI advertised `--source pixabay` as functional while real `pickService` returned `provider_error` via `pixabaySourceNotWiredYet()`.

| File | Action |
|------|--------|
| `src/app/pick-service.ts` | Modified — unwired branch → `invalid_input` / exit 3 / message `Pixabay pick is not yet available in this build` |
| `src/commands/pick.ts` | Modified — `--source` / `--safesearch` help states pixabay not yet available (parse contract kept) |
| `test/app/pick-semantic-service.test.ts` | Modified — real unmocked `pickService` asserts invalid_input/exit 3, not provider_error/exit 4 |
| `test/commands/pick-semantic-options.test.ts` | Modified — help asserts `not yet available` |

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| R3-001 | `test/app/pick-semantic-service.test.ts` | Unit/App | ✅ 26/26 WU5a focused baseline | ✅ Written — exit 4 vs expected 3 (`provider_error`) | ✅ 1/1 focused + 27/27 WU5a suite | ➖ Single honesty contract (help assertion companion in CLI tests) | ➖ Minimal message/help only |

| Evidence | Result |
|----------|--------|
| RED command | `npx vitest run test/app/pick-semantic-service.test.ts -t "returns invalid_input exit 3 for source pixabay"` → **FAIL** expected 3 received 4 |
| GREEN command | same → exit 0, **1 passed** (11 skipped) |
| Focused WU5a | `npx vitest run test/commands/pick-semantic-options.test.ts test/app/pick-semantic-service.test.ts` → exit 0, **27 passed** (2 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Correction line budget | **40** changed lines vs staged WU5a (33 add + 7 del) — under frozen 50 |
| Commit status | **Not committed** — correction restaged into WU5a candidate |

### WU5b re-slice (feature-branch-chain)

Full-flow prototype preserved in `stash@{0}` (untouched). WU5b split into WU5b1 / WU5b2 / WU5b3.

### WU5b1 — Used-id persistence adapter

- [x] 3.2 WU5b1 RED→GREEN→REFACTOR used-id adapter (no pick wiring)

#### Branch

- `feat/pixabay-used-ids` from WU5a head `77b5728`
- Chain: feature-branch-chain (PR base = WU5a / tracker chain)
- **Not committed** (apply only; no review lifecycle)

#### Files

| File | Action |
|------|--------|
| `src/adapters/pixabay-used-ids.ts` | Created — append/read `.img-ia/pixabay/used-ids.jsonl` id→sha index |
| `test/adapters/pixabay-used-ids.test.ts` | Created — path/latest map, malformed self-heal, 0600/secret-free/invalid input |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.2 WU5b1 | `test/adapters/pixabay-used-ids.test.ts` | Unit (real FS tmp root) | ✅ related adapters 6/6 + CLI honesty 27/27 | ✅ Written — `ERR_MODULE_NOT_FOUND` | ✅ 3/3 dense cases passed | ✅ latest-wins + idempotent re-append; malformed/torn heal + append after torn tail; 0600/secret-free/invalid id+sha + bad root | ✅ Shared id/sha validators; torn-tail newline heal via separate RDONLY open (Win O_WRONLY); densified tests |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/adapters/pixabay-used-ids.test.ts` → exit 0, **3 passed** (1 file) |
| Related regression | `npx vitest run test/adapters/pixabay-used-ids.test.ts test/adapters/pixabay-response-cache.test.ts test/adapters/pixabay-client.test.ts test/adapters/storage-root-guard.test.ts` → exit 0, **20 passed** (4 files) |
| CLI honesty still fail-closed | `npx vitest run test/commands/pick-semantic-options.test.ts test/app/pick-semantic-service.test.ts` → exit 0, **27 passed** (2 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Lint | `npx eslint src/adapters/pixabay-used-ids.ts test/adapters/pixabay-used-ids.test.ts` → exit 0 |
| Runtime harness | **Temp root + real FS** append/read/malformed heal; no network, no API key, no customer images |
| Rollback boundary | Delete `src/adapters/pixabay-used-ids.ts` + `test/adapters/pixabay-used-ids.test.ts`. No pick/CLI/download wiring. |
| Authored line count | **318** (src 157 + test 161) — under 400 budget (forecast ~190) |
| Commit status | **Not committed** — apply only |
| Stash | `stash@{0}` full-flow prototype **not** popped/applied/dropped |

#### Behaviors delivered

- Path fixed at `<root>/.img-ia/pixabay/used-ids.jsonl` via `StorageRootGuard`
- `append(id, sha256)` durable O_APPEND + fsync + chmod 0600 + honest dir fsync; secret-free `{id,sha256}` only
- Torn final line healed (insert `\n` before next record) so append is not glued to partial JSON
- `readMap()` → latest sha per positive integer id; missing file → empty; malformed/invalid lines skipped
- Invalid id (≤0, non-integer) and non-64-hex sha rejected before write
- Pixabay pick CLI remains honestly fail-closed (`invalid_input` exit 3) — no WU5b2/WU5b3 wiring

### WU5b2 — Candidate acquisition seam

- [x] 3.3 WU5b2 RED→GREEN→REFACTOR candidate seam (search/cache/filter/rendition/dedupe); CLI stays fail-closed

#### Branch

- `feat/pixabay-candidate-acquisition` from WU5b1 `cb5faeb`
- Chain: feature-branch-chain (PR base = WU5b1 / prior chain)
- **Not committed** (apply only; no review lifecycle)

#### Files

| File | Action |
|------|--------|
| `src/app/pixabay-pick-service.ts` | Created — `acquirePixabayCandidate`, `buildPixabaySearchIdentity` (no download/CLI wiring) |
| `test/app/pixabay-pick-candidate.test.ts` | Created — cache/filter/dedupe/rendition/error taxonomy with fake client |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.3 WU5b2 | `test/app/pixabay-pick-candidate.test.ts` | Unit (fake client + temp cache/used-ids) | ✅ related Pixabay + CLI honesty 58/58 | ✅ Written — `ERR_MODULE_NOT_FOUND` | ✅ 2/2 dense cases passed | ✅ cache hit/miss/stale; dedupe+used map∩sha; band/size; cap; panorama API+local; rate/provider/no_candidate; cache IO non-fatal; no download surface | ✅ Compact types/helpers; densified to **397** authored lines |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/app/pixabay-pick-candidate.test.ts` → exit 0, **2 passed** (1 file) |
| Related regression | `npx vitest run test/app/pixabay-pick-candidate.test.ts test/adapters/pixabay-used-ids.test.ts test/adapters/pixabay-response-cache.test.ts test/adapters/pixabay-client.test.ts test/domain/pixabay-renditions.test.ts test/commands/pick-semantic-options.test.ts test/app/pick-semantic-service.test.ts` → exit 0, **60 passed** (7 files) |
| CLI honesty still fail-closed | pick-semantic suite asserts `not yet available` / `invalid_input` exit 3 — no production wiring to candidate seam |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Lint | `npx eslint src/app/pixabay-pick-service.ts test/app/pixabay-pick-candidate.test.ts` → exit 0 |
| Runtime harness | **Fake client + temp cache root + real PixabayUsedIds FS**; no network, no API key, no customer images, no Sharp/download |
| Rollback boundary | Delete `src/app/pixabay-pick-service.ts` + `test/app/pixabay-pick-candidate.test.ts`. No pick/CLI/download/transaction wiring. |
| Authored line count | **397** (src 170 + test 227) — under 400 budget (forecast ~300) |
| Commit status | **Not committed** — apply only |
| Stash | `stash@{0}` full-flow prototype **not** popped/applied/dropped |

#### Behaviors delivered

- `buildPixabaySearchIdentity`: key-free canonical identity with forced `image_type=photo`
- `acquirePixabayCandidate`: cache-aware search (hit/miss/stale; write failure non-fatal)
- API orientation via `orientationParam`; local `aspectBand` filter (incl. panorama)
- Hit id dedupe; used exclusion via `PixabayUsedIds.readMap()` ∩ injectable `usedShas` (D4)
- `selectRendition` ladder + `resolution_cap` warning; deterministic first-eligible winner
- Error taxonomy: `rate_limited` / `provider_error` / `no_candidate` (secret-free messages)
- **No** download, Sharp, `_out`, usage, manifest, or `pickService`/CLI functional wiring

### WU5b3 — Functional Pixabay pick transaction + CLI wiring

- [x] 3.4 WU5b3 RED→GREEN→REFACTOR download/Sharp/usage/used-id + wire pickService/CLI

#### Branch

- `feat/pixabay-pick-transaction` from WU5b2 `dccaded`
- Chain: feature-branch-chain (PR base = WU5b2 / prior chain)
- **Not committed** (apply only; no review lifecycle in this recovery)

#### Files

| File | Action |
|------|--------|
| `src/app/pixabay-pick-service.ts` | Modified — `pickPixabayService` transaction (download→Sharp→usage→used-id) |
| `src/app/pick-service.ts` | Modified — wire explicit pixabay to `pickPixabayService`; extend `PickDeps` |
| `src/commands/pick.ts` | Modified — honest functional help; Pixabay credential resolver deps |
| `test/integration/pick-pixabay.test.ts` | Created — dense integration transaction harness |
| `test/commands/pick-semantic-options.test.ts` | Modified — credential-only deps + functional help (removed WU5a unwired stub) |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.4 WU5b3 | `test/integration/pick-pixabay.test.ts` + `test/commands/pick-semantic-options.test.ts` | Integration/CLI | ✅ candidate seam + CLI contract baseline | ✅ Written — fail-closed / missing wiring / empty deps | ✅ 18/18 focused (1 integration + 15 CLI + 2 candidate) | ✅ one-dl; cache hit; license/disclaimer; used-id after usage; allow-reuse; resolution_cap; usage_failed rollback; download fail; missing credential no local fallback; rate_limited; no_candidate (size/empty/orientation); secret-free | ✅ Atomic source write (Win overwrite); densified; commit raw later measured **433** |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/integration/pick-pixabay.test.ts test/commands/pick-semantic-options.test.ts` → exit 0, **16 passed** (2 files) |
| Related regression | + candidate/used-ids/client/cache/renditions → exit 0, **49 passed** (7 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Lint | `npx eslint` on 5 candidate paths → exit 0 |
| Runtime harness | **Temp root + real FS/Sharp + injected Pixabay client**; no network, no API key, no customer images |
| Rollback boundary | Revert the five candidate files (or drop branch). Does not touch Unsplash removal (WU6*). |
| Authored line count | **433** actual raw (`git show --numstat 243774d`; prior claim 400 was wrong). Maintainer-approved **`size:exception` scoped to commit `243774d` / WU5b3 only** — do not rewrite history; later budgets stay hard 400. |
| Commit status | **Committed** @ `243774d` |

#### Behaviors delivered

- First functional explicit `--source pixabay` pick (private BYOK resolver; no key leakage; no local fallback)
- Compose WU5b1 used-ids + WU5b2 candidate seam; exactly one download per pick
- No-upscale Sharp output; website-only license + disclaimer manifest fields
- Durable usage then used-id commit ordering; allow-reuse semantics
- Rollback on download/process/usage failures; taxonomy: success / no_candidate / rate_limited / provider_error / missing_pixabay_credential / usage_failed / filesystem_error
- Resolution-cap warning; honest functional CLI help (no “not yet available”)

### WU6a1 — Decouple pick path from Unsplash HTTP client (re-slice)

- [x] 4.1a WU6a1 RED→GREEN→REFACTOR fail-closed production Unsplash path without client import

#### Branch

- `feat/remove-unsplash-source` from WU5b3 `243774d`
- Chain: feature-branch-chain
- **Not committed** (apply only; no review lifecycle)

#### Why re-sliced

Original WU6a (delete client + test ≈295) plus mandatory pick-service import refactor + test updates exceeded the 400-line authored budget (~417+). Split into WU6a1 (path fail-closed / decouple) then WU6a2 (delete orphaned adapter files ≈295).

#### Files

| File | Action |
|------|--------|
| `src/app/pick-service.ts` | Modified — drop `unsplash-client` import; residual port types; production fail-closed `invalid_input` when no injected double |
| `test/app/pick-unsplash-credential.test.ts` | Modified — production fail-closed + resolver ignored; injected double still works |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1a WU6a1 | `test/app/pick-unsplash-credential.test.ts` | Unit/App | ✅ Pixabay/local/CLI baseline green | ✅ Written — exit 4/missing_unsplash_credential vs expected fail-closed | ✅ 31 focused + 57 related passed | ✅ no-client fail-closed + resolver ignored + injected double still succeeds | ✅ Compact residual port types; no client import |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/commands/pick-semantic-options.test.ts test/integration/pick-pixabay.test.ts test/app/pick-unsplash-credential.test.ts test/app/pick-semantic-service.test.ts` → exit 0, **31+ passed** |
| Related regression | + unsplash-client (orphaned) + pixabay client/candidate/renditions → exit 0, **57 passed** (8 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Lint | `npx eslint src/app/pick-service.ts test/app/pick-unsplash-credential.test.ts` → exit 0 |
| Runtime harness | **N/A** — service-level fail-closed; no network; CLI enum still accepts `unsplash` until WU6c |
| Rollback boundary | Revert `src/app/pick-service.ts` + `test/app/pick-unsplash-credential.test.ts`. Client files untouched. |
| Authored line count | **122** (46 add + 76 del) — under 400 budget |
| Commit status | **Not committed** — apply only |
| Import scan | Only `test/adapters/unsplash-client.test.ts` still imports `unsplash-client` (orphaned adapter retained for WU6a2) |

#### Behaviors delivered

- Production `--source unsplash` without injected double → `invalid_input` exit 3, message mentions Unsplash, **no** setup/developers/migration guidance, secret-free
- Residual credential resolver alone does not reopen Unsplash HTTP
- Injected `unsplashClient` doubles still exercise residual path (removed in later WU6*)
- Local + Pixabay pick paths unchanged
- `unsplash-client.ts` orphaned (no production imports) — deletion is WU6a2

### WU6a2 — Delete orphaned Unsplash HTTP client

- [x] 4.1b WU6a2 RED→GREEN→REFACTOR delete orphaned adapter + dedicated test

#### Branch

- `feat/remove-unsplash-client` from WU6a1 `59c8707`
- Chain: feature-branch-chain (PR base = WU6a1 / prior chain)
- **Not committed** (apply only; no review lifecycle)

#### Files

| File | Action |
|------|--------|
| `src/adapters/unsplash-client.ts` | Deleted — orphaned HTTP adapter (no production consumers after WU6a1) |
| `test/adapters/unsplash-client.test.ts` | Deleted — dedicated adapter suite |
| `test/adapters/unsplash-client-removed.test.ts` | Created — static removal guard (module absent + no production import/construction) |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1b WU6a2 | `test/adapters/unsplash-client-removed.test.ts` | Unit (static FS/import scan) | ✅ pick/local/Pixabay focused 19/19 + tsc | ✅ Written — `existsSync(adapter)` expected false, received true | ✅ 1/1 removal + 31 focused related passed | ✅ Adapter gone + dedicated test gone + production import/construction scan empty (two absence paths + src walk) | ➖ Structural deletion only; triangulation covered dual-file absence + import scan |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/adapters/unsplash-client-removed.test.ts test/commands/pick-semantic-options.test.ts test/integration/pick-pixabay.test.ts test/app/pick-unsplash-credential.test.ts test/app/pick-semantic-service.test.ts` → exit 0, **31 passed** (5 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Lint | `npx eslint test/adapters/unsplash-client-removed.test.ts` → exit 0 |
| Source-reference scan | `src/**/*.ts` and `test/**/*.ts`: **no** `unsplash-client` import/construction remains |
| Runtime harness | **N/A** — adapter removed; no HTTP/CLI boundary in this slice (setup/enum teardown is WU6b/WU6c) |
| Rollback boundary | Restore `src/adapters/unsplash-client.ts` + `test/adapters/unsplash-client.test.ts`; delete `test/adapters/unsplash-client-removed.test.ts` |
| Authored line count | **342** (47 add + 295 del) — under 400 budget (forecast ~295) |
| Commit status | **Not committed** — apply only |
| Deletion count | **2 files deleted** (241 + 54 lines) |

#### Behaviors delivered

- Orphaned Unsplash HTTP client module fully removed from the tree
- Dedicated adapter unit test removed with it
- Permanent static guard proves module absence and zero production import/construction
- Pick Pixabay/local/fail-closed Unsplash residual path unchanged (WU6b/WU6c own setup/enum teardown)

### WU6b1 — Remove Unsplash setup dispatch/help (service retained)

- [x] 4.2.1 WU6b1 RED→GREEN→REFACTOR remove setup import/dispatch + help; retain service + set-guard guidance

#### Branch

- `feat/remove-unsplash-config` from WU6a2 `f4e9381`
- Chain: feature-branch-chain (PR base = WU6a2 / prior chain)
- **Not committed** (apply only; no review lifecycle)
- Full over-budget WU6b candidate remains in `stash@{0}` (untouched)

#### Files

| File | Action |
|------|--------|
| `src/app/config-service.ts` | Modified — drop unsplash setup import/dispatch; `invalid()` lists pixabay setup; set-guard still guidance-bearing until WU6b2 |
| `src/commands/config.ts` | Modified — help drops `unsplash setup`; keeps generic + pixabay setup |
| `src/app/unsplash-setup-service.ts` | **Retained** for WU6b2 |
| `test/app/unsplash-setup-service.test.ts` | **Retained** for WU6b2 (legacy service + set-block suite) |
| `test/commands/config-unsplash-setup.test.ts` | Deleted — replaced by removed suite |
| `test/commands/config-unsplash-removed.test.ts` | Created — CLI exit 3/no guidance/no `--access-key`/help |
| `test/app/unsplash-setup-removed.test.ts` | Created — setup unavailable + set-block + legacy inert + Pixabay intact |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.2.1 WU6b1 | `test/app/unsplash-setup-removed.test.ts` + `test/commands/config-unsplash-removed.test.ts` | Unit/App + CLI | ✅ config/pixabay/setup baseline 15/15 | ✅ Written — setup exit 0 / non-TTY guidance / help ads unsplash | ✅ Proof(1) 19/19 + related 37/37 | ✅ setup unavailable + positional secret ignored + set blocked (user/project/whole) + legacy preserved/not migrated + Pixabay setup+set-block + CLI help/no `--access-key` | ✅ Compact dispatch removal; `invalid()` lists pixabay only |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command (Proof(1)) | `npx vitest run test/app/unsplash-setup-service.test.ts test/app/unsplash-setup-removed.test.ts test/commands/config-unsplash-removed.test.ts test/commands/config-pixabay-setup.test.ts test/app/pixabay-setup-service.test.ts` → exit 0, **19 passed** (5 files) |
| Related regression | + pick-unsplash-credential + pick-semantic-options → exit 0, **37 passed** (7 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Lint | `npx eslint src/app/config-service.ts src/commands/config.ts test/app/unsplash-setup-removed.test.ts test/commands/config-unsplash-removed.test.ts` → exit 0 |
| Runtime harness | `npm run build; node dist/cli/program.js --json config unsplash setup SAFE_SENTINEL` → exit **3**, generic `invalid_input`, message `Expected config …\|pixabay setup`, **no** unsplash/developers/setup guidance, sentinel not echoed; `config pixabay setup` → exit 3 + `missing_pixabay_credential`; `config --help` has pixabay setup, **no** unsplash setup; generic `config setup` still routes. No secrets used. |
| Rollback boundary | Restore unsplash setup import/dispatch in `config-service.ts`; restore help strings in `config.ts`; restore `test/commands/config-unsplash-setup.test.ts`; delete the two `*-removed` test files. Service file never deleted. |
| Authored line count | **343** raw (`251` add + `92` del) — under 400 budget (forecast ~290) |
| Commit status | **Not committed** — apply only |
| Stash | `stash@{0}` over-budget full WU6b **not** popped/applied/dropped |

#### Behaviors delivered

- `smart-img config unsplash setup` unavailable → exit 3 generic `invalid_input`, **no** Unsplash setup/developers/migration guidance
- No secret-bearing argv route (`--access-key` rejected; positional setup value ignored / not echoed)
- `config set unsplash.*` still blocked (guidance-bearing set-guard retained until WU6b2)
- Legacy `unsplash.accessKey` preserved on disk, not migrated into Pixabay, not echoed raw by `config list`, does not reactivate setup
- Pixabay private setup + set-block + generic provider `config setup` unchanged
- `src/app/unsplash-setup-service.ts` + its unit test retained for WU6b2 deletion
- Runtime resolver / schema / pick `--source unsplash` enum left for WU6c

### WU6b2 — Generic set-guard + delete orphaned setup service

- [x] 4.2.2 WU6b2 RED→GREEN→REFACTOR generic `unsplash.*` set-block + delete setup service/tests + static absence

#### Branch

- `feat/remove-unsplash-setup-service` from WU6b1 `1153d29`
- Chain: feature-branch-chain (PR base = WU6b1 / prior chain)
- **Not committed** (apply only; no review lifecycle)
- Full over-budget WU6b candidate remains in `stash@{0}` (untouched)

#### Files

| File | Action |
|------|--------|
| `src/app/config-service.ts` | Modified — `unsplashSetBlocked()` → generic `invalid()` (no setup/developer/migration guidance) |
| `src/app/unsplash-setup-service.ts` | **Deleted** — orphaned setup service |
| `test/app/unsplash-setup-service.test.ts` | **Deleted** — dedicated legacy unit suite |
| `test/app/unsplash-setup-removed.test.ts` | Modified — set-block no-guidance tighten + static absence (module/test gone, zero imports/calls) |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.2.2 WU6b2 | `test/app/unsplash-setup-removed.test.ts` | Unit/App (static FS + service) | ✅ Proof(1) baseline 19/19 → focused removed suite green pre-change | ✅ Written — `existsSync(service)` true; set-block still guided (`config unsplash setup`) | ✅ Proof(2) 10/10 + related 29/29 | ✅ static dual-file absence + import/call scan; set user/whole/project no guidance; setup dead; legacy inert; Pixabay intact | ✅ Minimal body `return invalid()`; densified static guard to keep raw **385** |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command (Proof(2)) | `npx vitest run test/app/unsplash-setup-removed.test.ts test/commands/config-unsplash-removed.test.ts test/commands/config-pixabay-setup.test.ts test/app/pixabay-setup-service.test.ts` → exit 0, **10 passed** (4 files) |
| Related regression | + pick-unsplash-credential + pick-semantic-options + pick-pixabay → exit 0, **29 passed** (7 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Lint | `npx eslint src/app/config-service.ts test/app/unsplash-setup-removed.test.ts test/commands/config-unsplash-removed.test.ts` → exit 0 |
| Runtime harness | `npm run build`; temp APPDATA: `config set unsplash.accessKey SAFE_SENTINEL` → exit **3**, generic `invalid_input`, **no write**, legacy key preserved, sentinel not echoed; `config unsplash setup SAFE_SENTINEL` → exit **3**/no guidance/no echo; `config pixabay setup` → exit 3 + `missing_pixabay_credential`. No secrets used. |
| Rollback boundary | Restore `src/app/unsplash-setup-service.ts` + `test/app/unsplash-setup-service.test.ts`; revert `unsplashSetBlocked` body and `test/app/unsplash-setup-removed.test.ts` additions. |
| Authored line count | **385** raw (`31` add + `354` del) — under 400 budget (forecast ~365) |
| Commit status | **Not committed** — apply only |
| Stash | `stash@{0}` over-budget full WU6b **not** popped/applied/dropped |

#### Behaviors delivered

- `config set unsplash.*` (user + project + whole subtree) blocked with **generic** `invalid_input` — **no** setup/developer/migration/private-terminal guidance, no secret echo, no write
- Orphaned `unsplash-setup-service` module + dedicated unit test fully deleted
- Static guard proves dual-file absence and zero `unsplashSetupService` / module imports-calls in `src`/`test`
- Setup route still generic exit 3 (from WU6b1); legacy on-disk key inert/unmigrated/redacted
- Pixabay private setup + set-block + generic provider config unchanged
- Runtime resolver / schema / pick `--source unsplash` enum left for WU6c
- Docs untouched (WU7)

### WU6c1 — Runtime credential + schema strip (re-slice)

- [x] 4.3.1 WU6c1 RED→GREEN→REFACTOR strip schema/resolver; preserve on-disk legacy; no CLI enum teardown yet

#### Why re-sliced

Full WU6c (runtime+schema+CLI enum+pick-service teardown+e2e+test deletes) exceeds 400 raw: pick-service Unsplash-only code alone is ~251 deletions; combining with large test rewrites/deletes overshoots. Split into WU6c1 (runtime/schema), WU6c2 (CLI enum+e2e), WU6c3 (pick-service teardown).

#### Branch

- `feat/remove-unsplash-runtime` from WU6b2 `7e54d52`
- Chain: feature-branch-chain (PR base = WU6b2 / prior chain)
- **Not committed** (apply only; no review lifecycle)

#### Files

| File | Action |
|------|--------|
| `src/config/user-config.ts` | Modified — drop `unsplashConfigSchema`/`UnsplashConfig`; strip legacy `unsplash` in `parseUserConfig` |
| `src/app/runtime.ts` | Modified — delete resolver/error/types; `writeUserConfig` preserves on-disk legacy `unsplash` only |
| `src/commands/pick.ts` | Modified — drop `resolveUnsplashCredential` import; unsplash `buildPickDeps` returns `{}` |
| `src/app/pick-service.ts` | Modified — drop `ResolvedUnsplashCredential` import; residual port dep uses inline type |
| `test/config/user-config-unsplash.test.ts` | Modified — strip/preserve/no-leak contract |
| `test/app/unsplash-credential-precedence.test.ts` | Modified — static absence of resolver/schema symbols |
| `test/app/unsplash-setup-removed.test.ts` | Modified — list/get strip + on-disk preserve after pixabay setup |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.3.1 WU6c1 | `user-config-unsplash` + `unsplash-credential-precedence` + `unsplash-setup-removed` | Unit/App | ✅ 23/23 config/cred baseline | ✅ Written — still had `unsplash` on UserConfig + resolver exports | ✅ Proof(c1) 19/19 + related 53/53 | ✅ strip parse; list/get no leak; write preserves on-disk; write invents nothing; pixabay setup keeps legacy disk; static symbol absence | ✅ Compact strip + preserve payload merge; held **379** raw |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command (Proof(c1)) | `npx vitest run test/config/user-config-unsplash.test.ts test/app/unsplash-credential-precedence.test.ts test/app/unsplash-setup-removed.test.ts test/app/pixabay-credential-precedence.test.ts test/app/pixabay-setup-service.test.ts test/commands/config-unsplash-removed.test.ts test/commands/config-pixabay-setup.test.ts` → exit 0, **19 passed** (8 files incl. pick-unsplash residual) |
| Related regression | + pick-semantic-options + pick-pixabay + pick-semantic-service + doctor → exit 0, **53 passed** (12 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Lint | `npx eslint` on 7 candidate paths → exit 0 |
| Runtime harness | `npm run build`; temp APPDATA legacy config: `config list` → exit 0, **no** `"unsplash"` / no legacy key; `config get unsplash.accessKey` → exit 0, no key; `config set unsplash.accessKey SAFE_SENTINEL` → exit 3 generic, on-disk legacy preserved; `config pixabay setup` → exit 3 + `missing_pixabay_credential`. No secrets used. |
| Rollback boundary | Revert the seven candidate files (or drop branch). Does not remove CLI enum / pickUnsplashService (WU6c2/c3). |
| Authored line count | **379** raw (`116` add + `263` del) — under 400 budget |
| Commit status | **Not committed** — apply only |

#### Behaviors delivered

- Normalized `UserConfig` has **no** `unsplash` field; legacy on-disk block parses without crash and is stripped from runtime output
- `writeUserConfig` preserves existing on-disk `unsplash` when rewriting (pixabay setup does not migrate or erase legacy disk key) and never invents `unsplash` when absent
- `config list` / `config get` do not leak legacy Unsplash keys or expose an `unsplash` object
- `resolveUnsplashCredential` / `MissingUnsplashCredentialError` / `ResolvedUnsplashCredential` / `UNSPLASH_ACCESS_KEY` guidance removed from runtime
- `unsplashConfigSchema` / `UnsplashConfig` removed from user-config module
- Pick CLI no longer wires Unsplash credentials; residual `--source unsplash` enum + service port remain for WU6c2/c3 (still fail-closed without client)
- Pixabay credential/setup paths unchanged

### WU6c2 — CLI source enum + e2e rejection

- [x] 4.3.2 WU6c2 RED→GREEN→REFACTOR CLI `--source` local|pixabay only; reject unsplash before service

#### Branch

- `feat/remove-unsplash-cli-source` from WU6c1 `3cf91f2`
- Chain: feature-branch-chain (PR base = WU6c1 / prior chain)
- **Not committed** (apply only; no review lifecycle)

#### Files

| File | Action |
|------|--------|
| `src/commands/pick.ts` | Modified — `VALID_SOURCES` = local\|pixabay; help text; drop unsplash query/panorama requirements + dead `buildPickDeps` unsplash branch |
| `test/commands/pick-semantic-options.test.ts` | Modified — enum reject unsplash; CLI before-service rejection; help local\|pixabay only |
| `test/e2e/pick-source-rejection.test.ts` | Created — built-path `runCli` e2e: unsplash exit 3 / no fetch; local+pixabay still accepted |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.3.2 WU6c2 | `pick-semantic-options` + `pick-source-rejection` e2e | Unit/CLI + E2E | ✅ 15/15 pick-semantic baseline | ✅ Written — unsplash still accepted / help lists unsplash / e2e hit service path | ✅ Proof(c2) 16/16 + related 59/59 | ✅ enum unit + CLI missing-query + with-query/panorama + help no-unsplash; e2e fetch stub + local/pixabay still accepted | ✅ Dropped dead unsplash source-requirement + buildPickDeps branch; held **217** raw |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command (Proof(c2)) | `npx vitest run test/commands/pick-semantic-options.test.ts test/e2e/pick-source-rejection.test.ts` → exit 0, **16 passed** (2 files) |
| Related regression | + pick-pixabay + pick-semantic-service + pick-unsplash-credential + numeric-validation → exit 0, **59 passed** (6 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Lint | `npx eslint src/commands/pick.ts test/commands/pick-semantic-options.test.ts test/e2e/pick-source-rejection.test.ts` → exit 0 |
| Runtime harness | `npm run build`; temp APPDATA: `node dist/cli/program.js --json pick <tmp> --source unsplash --query SAFE_SENTINEL` → exit **3**, `invalid_input`, message `--source must be one of: local, pixabay, got: "unsplash"`, no guidance/setup URLs, sentinel not echoed; `--source pixabay --query kitchen` → exit 4 `missing_pixabay_credential` (enum still accepts pixabay); `pick --help` source line = `local or pixabay`, no unsplash. No secrets/network. |
| Rollback boundary | Revert `src/commands/pick.ts` + `test/commands/pick-semantic-options.test.ts`; delete `test/e2e/pick-source-rejection.test.ts`. Does not touch pick-service Unsplash port (WU6c3). |
| Authored line count | **217** raw (`36` tracked add + `39` del + `142` new e2e) — under 400 budget (forecast ≤350) |
| Commit status | **Not committed** — apply only |

#### Behaviors delivered

- CLI `--source` accepted surface is **local \| pixabay** only
- `--source unsplash` → exit **3** `invalid_input` at enum validation **before** `buildPickDeps` / `pickService` / network
- Error lists allowed sources; **no** Unsplash setup/developers/migration/query-required guidance
- Help text no longer advertises unsplash
- Local + Pixabay pick paths unchanged; residual pick-service Unsplash port remains for WU6c3 (unreachable from CLI)

### WU6c3a — obsolete Unsplash pick test deletion (re-slice)

- [x] 4.3.3a WU6c3a RED→GREEN→REFACTOR delete obsolete Unsplash pick coverage only (no production teardown)

#### Why re-sliced

Combined WU6c3 candidate was ~587 raw (pick-service teardown + obsolete test deletions + static guard). Hard 400 budget required split: WU6c3a = obsolete tests only (295 del); WU6c3b = core service teardown + static guard (292). No `size:exception`.

#### Branch

- `feat/remove-unsplash-pick-service-core` from WU6c2 `6be2787`
- Chain: feature-branch-chain (PR base = WU6c2 / prior chain)
- **Committed** @ `9ce6678` `test(pick): remove obsolete unsplash coverage`

#### Files

| File | Action |
|------|--------|
| `test/app/pick-unsplash-credential.test.ts` | **Deleted** — residual credential/double suite (174 del) |
| `test/app/pick-semantic-service.test.ts` | Modified — remove residual Unsplash success/reuse tests + helper (121 del) |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.3.3a WU6c3a | pick-semantic-service cleanup + credential suite delete | Unit/App | ✅ pick/pixabay/CLI baseline green pre-deletion | ✅ Residual Unsplash tests still present while production path already unreachable from CLI (WU6c2) | ✅ Prior verification **26 tests** + typecheck/build/lint green after deletion | ✅ dual-file deletion paths (credential suite + semantic Unsplash cases) | ➖ Structural test deletion only |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused / prior verification (Proof(c3a)) | Prior batch: **26 tests** passed after obsolete Unsplash coverage removal + typecheck/build/lint |
| Typecheck | `npx tsc --noEmit` → exit 0 (prior WU6c3a verification) |
| Build / Lint | `npm run build` + eslint on touched test paths → exit 0 (prior WU6c3a verification) |
| Runtime harness | **N/A** — test-only deletion; no production boundary change in this slice (service teardown is WU6c3b) |
| Rollback boundary | Restore `test/app/pick-unsplash-credential.test.ts` + Unsplash cases in `test/app/pick-semantic-service.test.ts` from pre-`9ce6678` |
| Authored line count | **295** raw (`0` add + `295` del) — under 400 budget |
| Commit status | **Committed** @ `9ce6678` |

#### Behaviors delivered

- Dedicated `pick-unsplash-credential` suite fully deleted
- Residual Unsplash success/reuse coverage removed from `pick-semantic-service` tests
- No production code changes in this slice
- Docs untouched (WU7)

### WU6c3b — pick-service Unsplash teardown + static absence guard

- [x] 4.3.3b WU6c3b RED→GREEN→REFACTOR delete residual Unsplash port/dispatch/impl + static absence guard

#### Branch

- `feat/remove-unsplash-pick-service-core` from WU6c3a `9ce6678`
- Chain: feature-branch-chain (PR base = WU6c3a / prior chain)
- **Not committed** (apply only; no review lifecycle)

#### Files

| File | Action |
|------|--------|
| `src/app/pick-service.ts` | Modified — drop Unsplash port types, `PickDeps` injectors, dispatch, `pickUnsplashService` + helpers; `PickSource = local\|pixabay` (3 add / 252 del = 255 raw) |
| `test/app/pick-unsplash-removed.test.ts` | Created — static absence (PickSource contract + banned symbols + src/test scan) (37 raw) |

#### Scope check

- Exactly core service teardown + static absence guard
- **No** WU7 docs (`README*`, `.agents/*`, `docs/*`, `AGENTS.md` unchanged)
- **No** further test-suite deletions (those landed in WU6c3a `9ce6678`)

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.3.3b WU6c3b | `test/app/pick-unsplash-removed.test.ts` | Unit (static FS/import scan) | ✅ WU6c3a committed baseline; pick/pixabay/CLI related green | ✅ Written — residual port/impl still present before teardown (static guard would fail on banned symbols / PickSource still includes unsplash) | ✅ Proof(c3b) **27/27** + related **31/31** | ✅ PickSource contract + dual banned-symbol scans (pick-service body + cross-tree walk excluding prior removal/rejection contracts) | ✅ Densified static guard to **37** lines; production helpers fully removed |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command (Proof(c3b)) | `npx vitest run test/app/pick-unsplash-removed.test.ts test/app/pick-semantic-service.test.ts test/integration/pick-pixabay.test.ts test/commands/pick-semantic-options.test.ts test/e2e/pick-source-rejection.test.ts` → exit 0, **27 passed** (5 files) |
| Related regression | + pixabay-pick-candidate + unsplash-client-removed + unsplash-credential-precedence → exit 0, **31 passed** (8 files) |
| Typecheck | `npx tsc --noEmit` → exit 0 |
| Lint | `npx eslint src/app/pick-service.ts test/app/pick-unsplash-removed.test.ts test/app/pick-semantic-service.test.ts` → exit 0 |
| Build | `npm run build` → exit 0 |
| Runtime harness | `npm run build`; temp APPDATA: `node dist/cli/program.js --json pick <tmp> --source unsplash --query SAFE_SENTINEL` → exit **3** `invalid_input` message `--source must be one of: local, pixabay, got: "unsplash"` (no service path); `--source pixabay --query kitchen` → exit 4 `missing_pixabay_credential`; `pick --help` source line = `local or pixabay`; `src/**/*.ts` scan: **no** `pickUnsplashService`/`unsplashClient`/`UnsplashClientPort`/`writeUnsplashSource`/`UnsplashPhoto`. No secrets/network/customer images. |
| Rollback boundary | Restore Unsplash block in `src/app/pick-service.ts` from WU6c3a tree; delete `test/app/pick-unsplash-removed.test.ts`. Does not restore WU6c3a test deletions. |
| Authored line count | **292** raw (`3+37` add + `252` del) — under 400 budget (no size:exception) |
| Commit status | **Not committed** — apply only |

#### Behaviors delivered

- `PickSource` is **`local | pixabay` only** (no Unsplash in service type surface)
- Residual Unsplash port types, `unsplashClient` / `resolveUnsplashCredential` deps, dispatch, `pickUnsplashService`, and Unsplash-only helpers fully deleted
- Static guard proves PickSource contract + zero residual pick-service Unsplash symbols in `src`/`test` (except prior removal/rejection contracts)
- Local semantic pick + Pixabay pick paths unchanged
- CLI `--source unsplash` remains exit 3 at enum (WU6c2); no service-level Unsplash path remains
- Docs untouched (WU7)

### WU7 — Documentation (README, skill, Pixabay provider doc)

- [x] 5.1 WU7 RED→GREEN docs contract: Pixabay path documented; Unsplash operational claims removed from active docs

#### Branch

- `docs/pixabay-provider` from WU6c3b `baa0c6c`
- Chain: feature-branch-chain (PR base = WU6c3b / prior chain)
- **Not committed** (apply only; no review lifecycle)

#### Files

| File | Action |
|------|--------|
| `README.md` | Modified — `--source local\|pixabay`; Unsplash pick section → Pixabay summary + link to provider doc; roadmap |
| `.agents/skills/smart-image-cli/SKILL.md` | Modified — Pixabay decision gate, hard rules, no Unsplash setup path |
| `docs/providers/pixabay.md` | Created — canonical BYOK/cache/license/search/failure reference |

#### Scope check

- Docs only — **no** production `src/` or test suite changes
- Historical release notes / OpenSpec migration artifacts may still mention Unsplash by name
- Active operational docs no longer advertise `config unsplash setup` / `UNSPLASH_ACCESS_KEY` / unsplash.com developers flow

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1 WU7 | Docs static contract + CLI help/runtime harness (no new vitest file) | Docs/static + CLI | ✅ WU6c3b `baa0c6c` runtime (`pick`/`config` help already local\|pixabay) | ✅ Active docs still advertised Unsplash setup/`--source unsplash` before edit | ✅ Static contract 0 failures; help matches `local or pixabay` + `pixabay setup`; runtime unsplash exit 3 / missing pixabay cred exit 4 | ✅ README + skill + provider doc all cover setup/source/env/cache/safesearch/photo/license; dual absence of operational Unsplash setup strings | ✅ Cognitive-doc shape (quick path → details tables); held **183** raw |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | Docs static contract script (README/skill/pixabay.md content + no operational Unsplash setup strings) → **0 failures** |
| Runtime harness | `npm run build` already green on branch; `node dist/cli/program.js pick --help` → `local or pixabay`, has `--safesearch`, no unsplash; `config --help` → `pixabay setup`, no unsplash setup; temp APPDATA: `pick --source unsplash --query SAFE_SENTINEL` → exit **3** `invalid_input`; `pick --source pixabay --query kitchen` → exit **4** `missing_pixabay_credential`. No secrets/network/customer images. |
| Typecheck / production tests | **N/A for code** — docs-only slice; no `src/` or `test/` edits. Build used only to confirm help text. |
| Rollback boundary | Restore `README.md` + `.agents/skills/smart-image-cli/SKILL.md` from pre-WU7; delete `docs/providers/pixabay.md`. |
| Authored line count | **187** raw (tracked 49 add + 42 del; +96 new `docs/providers/pixabay.md`) — under 400 budget (forecast ~260); Prettier on skill + provider doc |
| Commit status | **Not committed** — apply only |

#### Behaviors delivered

- README documents explicit `--source pixabay`, private BYOK setup, env>config precedence, 24h cache, safesearch/photo defaults, used-id single download, no-upscale/`resolution_cap`, website-only license
- Project skill has Pixabay decision gate + hard rules; agents redirected away from chat keys and Unsplash
- Canonical `docs/providers/pixabay.md` covers setup, search, cache/429, selection, license, exit table
- Active docs no longer instruct Unsplash setup/pick; only residual mentions are rejection guidance for removed `--source unsplash`

### Quality-gate remediation (pre-5.2) — lint + Prettier only

Branch: `chore/pixabay-quality-gates` @ base `a4a3bf0`. Scope: unblock task 5.2 quality gates only. **Task 5.2 remains unchecked** until full gate rerun.

#### Behavior-preserving lint fix

| Issue | Fix |
|-------|-----|
| ESLint `no-useless-assignment` at `src/adapters/pixabay-client.ts` `secretFreeHttpMessage` | `let bodyText = ""` → `let bodyText: string` (assigned in `try` before any read; catch still returns `base`) |

No control-flow or message-shape change.

#### Prettier-only files

| File | Action |
|------|--------|
| `src/adapters/pixabay-client.ts` | Lint fix + Prettier |
| `src/adapters/pixabay-response-cache.ts` | Prettier only |
| `src/app/pick-service.ts` | Prettier only |
| `src/app/pixabay-pick-service.ts` | Prettier only |
| `src/commands/pick.ts` | Prettier only |

#### Work Unit Evidence (remediation)

| Evidence | Result |
|----------|--------|
| Focused tests | `npx vitest run` pixabay/pick suite (9 files) → exit 0, **39 passed** |
| Lint | `npm run lint` → exit 0; prior blocker cleared on `pixabay-client.ts` |
| Format | `npm run format` (`prettier --check`) → exit 0; five listed files clean |
| Typecheck | `npm run typecheck` → exit 0 |
| Build | `npm run build` → exit 0 |
| Full `npm test` | **Not rerun** in this batch (deferred to 5.2) |
| Raw review budget | **242** (`174` add + `68` del) across 5 files — under 400 |
| Rollback boundary | Restore the five `src/` files from `a4a3bf0` / discard working-tree formatting+lint fix. No docs/task checkbox changes for 5.2. |
| Commit status | **Not staged / not committed** |

### 5.2 — Final verification (release gate)

Branch: `chore/pixabay-quality-gates` @ `2c91304` (`chore(pixabay): satisfy quality gates`). Scope: **verification only** — no production/docs/tests edits in this batch. Isolated fixture CLI used temp `APPDATA` + empty image root; no API keys, no network calls, no customer images.

#### Quality gates (fresh full run)

| Command | Exit | Result |
|---------|------|--------|
| `npm test` (`vitest run`) | **0** | **55** files, **427** tests passed (duration ~14.3s) |
| `npm run build` (`tsc -p tsconfig.json`) | **0** | clean compile |
| `npm run typecheck` (`tsc --noEmit`) | **0** | clean |
| `npm run lint` (`eslint .`) | **0** | clean (post-`2c91304` remediation) |
| `npm run format` (`prettier --check …`) | **0** | All matched files use Prettier code style |

#### Fixture-safe CLI checks (isolated temp APPDATA/root)

Harness: `node dist/cli/program.js` with process `APPDATA` = temp dir; `PIXABAY_API_KEY` / `UNSPLASH_ACCESS_KEY` unset; empty image root under temp; sentinel value `SAFE_SENTINEL` only as intentional invalid input where applicable.

| Scenario | Command (abbrev.) | Exit | Exact outcome |
|----------|-------------------|------|---------------|
| pick help source/setup | `pick --help` | **0** | `--source` = `local or pixabay`; has `--safesearch`; **no** `unsplash` |
| config help setup | `config --help` | **0** | action text includes `pixabay setup`; **no** `unsplash setup` |
| Unsplash rejection | `--json pick <empty> --source unsplash --query SAFE_SENTINEL --category kitchen --orientation landscape --width 800 --height 600` | **3** | `invalid_input`: `--source must be one of: local, pixabay, got: "unsplash"`; sentinel **not** echoed |
| Pixabay missing credential | `--json pick <empty> --source pixabay --query kitchen …` (same slot flags) | **4** | `missing_pixabay_credential` + setup guidance (`config pixabay setup`); no network |
| Pixabay setup (non-TTY/private) | `--json config pixabay setup` | **3** | `invalid_input` / details.reason `missing_pixabay_credential` (interactive/private only) |
| Pixabay private-set blocked | `--json config set pixabay.apiKey SAFE_SENTINEL` | **3** | `invalid_input` → private interactive setup required; sentinel **not** echoed |
| Unsplash set blocked | `--json config set unsplash.accessKey SAFE_SENTINEL` | **3** | `invalid_input` generic expected-actions message; sentinel **not** echoed |
| Unsplash setup rejected | `--json config unsplash setup SAFE_SENTINEL` | **3** | `invalid_input` expected-actions only; **no** unsplash.com guidance; sentinel **not** echoed |
| Local empty-root path | `--json pick <empty> --source local --query kitchen …` | **5** | fail-closed `filesystem_error` (empty/temp root storage path); no network/secrets |
| Config list (empty user) | `--json config list` | **0** | success; `pixabay:{}` present; **no** `"unsplash"` key |
| Secret sentinel scan | all non-help fixture stdout/stderr above | — | **0** occurrences of `SAFE_SENTINEL` |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.2 | Full suite + fixture CLI harness (no new tests) | Release gate | ✅ Prior WU suites + remediation `2c91304` | N/A — verification-only; no production change | ✅ Full gates exit 0; 11/11 fixture scenarios pass | ✅ help + unsplash reject + pixabay missing cred/setup/set + local empty-root + list + sentinel scan | N/A — no code edits |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npm test` → exit **0**, **427 passed** / 55 files |
| Runtime harness command/scenario | Built CLI fixture matrix above (11 scenarios) → **all PASS**; isolated temp APPDATA; no keys/network/customer images |
| Rollback boundary | N/A for code — verification-only. Artifact-only: revert `tasks.md` 5.2 checkbox and this apply-progress section if gate evidence must be discarded. |
| Authored line count | **0** production/docs/tests; OpenSpec artifacts only |
| Commit status | **Not staged / not committed** (per apply instructions) |

#### Behaviors confirmed

- Quality gates green on post-remediation HEAD `2c91304`
- CLI surface is `local|pixabay` only; Unsplash source/setup/set fail closed without guidance URLs or secret echo
- Pixabay BYOK remains private interactive setup; missing credential exit **4** on pick; set/setup fail closed without writing secrets
- Empty local root fails closed without network
- No secret sentinel leakage in fixture outputs

### 5.3 — Final-verification remediation (CRIT-001 / CRIT-002 / CRIT-003)

Branch: `fix/pixabay-final-verification` @ parent `2c91304`. Mode: Strict TDD focused remediation after admitted FAIL verify (`openspec/changes/replace-unsplash-with-pixabay/verify-report.md`, `evidence_revision sha256:606301de2c74ab9398ba595545d9c87cbac8a36f76e0497e7d4cbcb5fc0a1ed7`). Failed report/history preserved — not rewritten as PASS.

Native runtime: `sdd-attempt reset` (exhausted final-verification objective) → `acquire` remediation (`work_unit=final-verification-remediation`, `remediates-evidence-revision` = failed verify envelope). Maintainer decision: `size:exception` only for historical `157ccdd` (430) and `243774d` (433).

#### Root causes

1. **CRIT-001**: `test/integration/pick-pixabay.test.ts` used bare `fs.rm` in `afterEach` instead of project `rmWithRetry`. On Windows, Sharp + better-sqlite3 (WAL) briefly lock files under temp Pixabay roots (`.img-ia/pixabay/cache`, sqlite, produced assets) → `ENOTEMPTY` on teardown. The single mega-`it` packed ~10+ Sharp/SQLite transactions; under focused 18-file parallel load it approached/exceeded Vitest’s default 5000ms, aborting mid-flight and worsening lock races. Not a production network/secret issue.
2. **CRIT-002**: `docs/providers/pixabay.md` failures table named removed `unsplash` → violates PIX-8 “no reference to Unsplash” for the provider doc.
3. **CRIT-003**: Historical WU2/WU5b3 commits were actually 430/433 raw; apply-progress claimed 398/400 without `size:exception`.

#### Files

| File | Action |
|------|--------|
| `test/integration/pick-pixabay.test.ts` | Modified — `rmWithRetry` teardown; static guard; split mega-test into success + failure cases (each well under 5s) |
| `docs/providers/pixabay.md` | Modified — generic unknown/unsupported `--source` wording; zero Unsplash tokens |
| `openspec/.../tasks.md` | Modified — scoped historical `size:exception`; task 5.3 |
| `openspec/.../apply-progress.md` | Modified — correct 430/433 counts; this remediation section |
| `openspec/.../verify-report.md` | **Unchanged** — admitted FAIL retained |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.3 CRIT-001 | `test/integration/pick-pixabay.test.ts` | Integration | ✅ prior 18-file focused suite (77) | ✅ Static guard expects `rmWithRetry` / forbids bare `fs.rm(r,{recursive` — failed on HEAD | ✅ 3/3 focused; 3× consecutive focused + 3× 18-file suite (79 tests) exit 0; no timeout/ENOTEMPTY | ✅ success path (license/used-id/cap/reuse/cache) + failure path (usage rollback/degrade/download/missing cred/rate/no_candidate) + teardown guard | ✅ Split mega-`it`; comments document Windows lock root cause; no timeout inflation |
| 5.3 CRIT-002 | docs contract (static) | Docs | ✅ prior WU7 content checks | ✅ `docs/providers/pixabay.md` matched `(?i)unsplash` | ✅ no Unsplash token; setup/source/cache/license content retained | ✅ failures table still documents exit 3 invalid_input generically | ✅ Prettier table realign only |
| 5.3 CRIT-003 | tasks + apply-progress | Artifact | N/A | N/A — bookkeeping | ✅ recorded exception + corrected raw counts | ✅ scoped to two commits only | N/A |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/integration/pick-pixabay.test.ts` → exit **0**, **3 passed** (guard ~7ms; success ~700–730ms; failures ~246–293ms) × **3 consecutive** |
| Related regression | 18-file focused Pixabay/removal suite → exit **0**, **79 passed** × **3 consecutive** (was 77; +2 from split/guard) |
| Runtime harness | Temp roots + real Sharp/FS + injected Pixabay client; **no network, no real secrets, no customer images** |
| Quality gates | `npm run typecheck` 0; `npm run lint` 0; `npm run format` 0; `npm run build` 0; docs no-Unsplash check PASS |
| Rollback boundary | Restore `test/integration/pick-pixabay.test.ts` + `docs/providers/pixabay.md` from `2c91304`; revert tasks/apply-progress remediation/exception notes. Leave `verify-report.md` untouched. |
| Authored line count (code/docs only) | **292** raw (`202` add + `90` del) on `pick-pixabay.test.ts` + `pixabay.md` — under 400. OpenSpec artifact updates excluded from review-budget code count. |
| `size:exception` | Historical only: WU2/`157ccdd`=**430**, WU5b3/`243774d`=**433**. No exception for this remediation batch. |
| Commit status | **Not staged / not committed** (per apply instructions) |
| Independent verify | **Not run / not marked PASS** — ready for fresh `sdd-verify` |
| Remediation evidence | `remediation-report.md` + native finish `passed`; `evidence_revision sha256:b1502e4776a60373db0442388cecccbd4afbeafb658c2d67c08e157a01436d11`; failed verify envelope preserved |

#### Behaviors confirmed after remediation

- Teardown uses `rmWithRetry` (EBUSY/EPERM/ENOTEMPTY) matching other integration/e2e suites
- Transaction coverage retained: one download, license/disclaimer, used-id, allow-reuse, resolution_cap, cache hit, usage rollback, used-id degrade, download/provider errors, missing credential (no local fallback), rate_limited, no_candidate variants, secret-free
- Provider doc documents invalid source generically with **no Unsplash reference**
- Budget evidence matches `git show --numstat` with explicit scoped exceptions

### 5.4 — Final-verification remediation (CRIT-004 EXIF optimization-flow timeout)

Branch: `fix/exif-test-stability` @ parent `e1dcc34` → HEAD **`b0ca039`**. Mode: Strict TDD focused remediation after admitted FAIL verify (`verify-report.md`, `evidence_revision sha256:6f856e9e20bb8137e5c4f2a490431254cde46a7215308cf9a0928438b8de23cb`). Prior FAIL history preserved — not rewritten as PASS.

Native runtime: exhausted gen-3 independent-final-verification remaining attempt (reconfirmed CRIT-004) → `sdd-attempt reset` → `acquire` remediation (`work_unit=final-verification-remediation-crit004`, generation 4 / objective `sha256:cc3a9978f3cc743d352ef587f30dbb58918dafb7be58b9b2d8ff69c70318a8d7`, `remediates-evidence-revision` = failed verify envelope, max_changed_lines 400). Ordinal-5 attempt **finished passed** (`changed_lines=89`, `evidence_revision sha256:118f6613eed931c6bb5233a05422cad4171a2cb86db0e1e6d5e041e28242180c`, finish tree `02faa7c083983c827cfd0dc82d570a950e8c430e`). Successor-lineage finish blocked on empty native `binding_revision`; plain finish accepted. Review binding still authoritative via `review validate --gate post-apply allow` (see Review / Correction Evidence).

#### Root cause

**CRIT-004**: `test/integration/optimization-flow.test.ts` case “normalizes EXIF orientation…” planted `Orientation: 6` via live `exiftool.write(..., ["-overwrite_original", "-n"])` plus native singleton lifecycle. Production path under test is only Sharp `.rotate()` through `optimizeService` → `SharpProcessor.produce` (no ExifTool on the default optimize path). Under full `npm test` load, native ExifTool singleton cold-start/contention pushed the single `it` past Vitest’s default **5000ms** (report: 54/55 files, 428/429 tests). Focused alone was ~0.7–2.6s under concurrent load. Sharp’s own `withExif` cannot plant Orientation=6 (normalizes to 1). Blind timeout inflation was rejected.

#### Files

| File | Action |
|------|--------|
| `test/integration/optimization-flow.test.ts` | Modified — embedded Orientation=6 JPEG fixture replaces live ExifTool fixture writes; retain dynamic `afterAll` singleton shutdown; static no-live-exiftool guard; assert planted orientation before optimize |
| `openspec/.../tasks.md` | Modified — task 5.4 scoped completed remediation |
| `openspec/.../apply-progress.md` | Modified — this section + review/correction evidence |
| `openspec/.../remediation-report.md` | Modified — CRIT-004 remediation envelope with review binding |
| `openspec/.../verify-report.md` | **Unchanged** — admitted FAIL retained |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.4 CRIT-004 | `test/integration/optimization-flow.test.ts` | Integration | ✅ baseline optimization-flow green pre-change | ✅ Static guard forbids reintroducing live ExifTool fixture planting; requires embedded Orientation=6 fixture path | ✅ 7/7 focused × **5 consecutive**; quality gates green; salvage full suite mixed (see Work Unit) | ✅ planted orientation=6 asserted; control vs rotated dimension difference retained; static code-only guard + fixture helper; dynamic afterAll singleton shutdown retained | ✅ No live fixture writes; no Vitest timeout inflation; R3-001 bounded correction (6 raw) inside review budget |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/integration/optimization-flow.test.ts` → exit **0**, **7 passed** × **5 consecutive** |
| Full suite (salvage only) | first salvage exposed **unrelated** `pick-pixabay` timeout; second salvage exit **0**, **55 files / 430 tests**. **Not** independent PASS — final verify must rerun full suite |
| Runtime harness | Temp `os.tmpdir()` roots only + real Sharp optimize path; **no network, no secrets, no customer images**; no live ExifTool fixture planting in this suite |
| Quality gates | `npm run typecheck` 0; `npm run lint` 0; `npm run format` 0; `npm run build` 0 |
| Rollback boundary | Revert commit `b0ca039` (or restore `test/integration/optimization-flow.test.ts` from `e1dcc34`); revert tasks/apply-progress/remediation 5.4 notes. Leave `verify-report.md` untouched. |
| Authored line count (code only) | **89** raw (`57` add + `32` del) on `optimization-flow.test.ts` per `git show --numstat b0ca039` — under 400. No `size:exception`. |
| Commit status | **Committed** @ `b0ca039` (`test(optimize): stabilize EXIF fixture setup`) on `fix/exif-test-stability` |
| Independent verify | **Not run / not marked PASS** — ready for independent `sdd-verify` after native finish + review binding |
| Remediation evidence | `remediation-report.md`; `evidence_revision sha256:118f6613eed931c6bb5233a05422cad4171a2cb86db0e1e6d5e041e28242180c`; failed verify envelope preserved |

#### Review / Correction Evidence

| Field | Value |
|-------|--------|
| Review lineage | `review-1937fac6d3f7e1c2` |
| Approved target | `sha256:18837501151b6e2c046fc724c06a8e5fcb50b6142d20307143a213236e4c21d5` |
| Gate | `review validate --gate post-apply` → **allow** (authoritative transaction, current repository target, content-bound artifacts match) |
| Pre-commit gate | allowed |
| Correction finding | **R3-001** fixed in **6** raw lines within review budget |
| Whole commit raw | **89** (`57+32`) |
| Production/docs bytes | **unchanged** by this bookkeeping batch |

#### Behaviors confirmed after remediation

- EXIF orientation normalization still proves `.rotate()` applied (dimension difference vs control + no orientation tag)
- Fixture planting uses embedded Orientation=6 JPEG (deterministic under load; no live ExifTool fixture writes)
- Dynamic `afterAll` singleton shutdown retained where required
- Static guard prevents reintroducing live ExifTool fixture planting in this file
- Default strip / keep-metadata / AVIF / bounds cases unchanged
- Native ExifTool adapter coverage remains in `test/adapters/exiftool-metadata.test.ts` (unchanged)

### 5.5 — Final-verification remediation (CRIT-001 recurrence — Pixabay success mega-test timeout)

Branch: `fix/pixabay-success-test-stability` @ HEAD **`e79db70`**. Mode: Strict TDD focused remediation after admitted FAIL verify (`verify-report.md` — CRIT-001 recurrence under gen-5 independent verification: Pixabay success mega-test timed out at Vitest 5000ms). Prior FAIL history preserved — **not rewritten as PASS**.

**Artifact-only bookkeeping batch**: records already-implemented and committed remediation evidence only. This apply batch did **not** change production/test code, did **not** re-run tests, and did **not** stage/commit/touch Git state.

#### Root cause

**CRIT-001 recurrence**: After CRIT-004 (`b0ca039`) resolved EXIF optimization-flow instability, independent verification still failed because the successful Pixabay transaction mega-test in `test/integration/pick-pixabay.test.ts` exceeded Vitest's default **5000ms** under full `npm test` and the 19-file relevant suite. That timeout invalidated passing runtime proof for required success scenarios (cap warning, exactly-one-download, license/metadata). Not a production network/secret/Pixabay client bug; no timeout inflation.

#### Files (code already committed @ `e79db70`; this batch updates OpenSpec only)

| File | Action |
|------|--------|
| `test/integration/pick-pixabay.test.ts` | **Already committed** — success mega-test split into **four autonomous scenarios** (56 add + 17 del = **73** raw) |
| `openspec/.../tasks.md` | Modified — task 5.5 records remediation evidence |
| `openspec/.../apply-progress.md` | Modified — this section |
| `openspec/.../remediation-report.md` | Modified — CRIT-001 recurrence remediation envelope + preserved priors |
| `openspec/.../verify-report.md` | **Unchanged** — admitted FAIL retained; fresh independent sdd-verify still required |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.5 CRIT-001 recurrence | `test/integration/pick-pixabay.test.ts` | Integration | ✅ prior pick-pixabay + 19-file baseline; CRIT-004 green | ✅ Independent verify FAIL: success mega-test timed out @ 5000ms (full + relevant suites) | ✅ Focused 6/6 × **5 consecutive**; relevant 19-file **89** tests × **3 consecutive**; full `npm test` **433** tests × **2 consecutive**; quality gates clean | ✅ Four autonomous success scenarios retain license/used-id/cap/reuse/cache coverage without packing one mega-`it` past 5s | ✅ Split only; no Vitest timeout inflation; no production edits |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused test command | `npx vitest run test/integration/pick-pixabay.test.ts` → exit **0**, **6/6 passed** × **5 consecutive** (remediation-side; not re-run in this bookkeeping batch) |
| Relevant 19-file suite | exit **0**, **19 files / 89 tests** × **3 consecutive** (remediation-side) |
| Full suite | `npm test` → exit **0**, **55 files / 433 tests** × **2 consecutive** (remediation-side evidence only — **not** independent sdd-verify PASS) |
| Quality gates | `npm run typecheck` 0; `npm run lint` 0; `npm run format` 0; `npm run build` 0 (remediation-side) |
| Runtime harness | Temp roots + real Sharp/FS + injected Pixabay client; **no network, no real secrets, no customer images** |
| Rollback boundary | Revert commit `e79db70` (or restore pre-split `test/integration/pick-pixabay.test.ts`); revert tasks/apply-progress/remediation 5.5 notes. Leave `verify-report.md` untouched. |
| Authored line count (code only) | **73** raw (`56` add + `17` del) on `pick-pixabay.test.ts` — under 400. No `size:exception`. |
| Commit status | **Already committed** @ `e79db70` on `fix/pixabay-success-test-stability` (this batch does not touch Git) |
| Independent verify | **Still required** — this section records remediation evidence only; **do not self-PASS**; prior admitted FAIL remains in `verify-report.md` |
| Remediation evidence | `remediation-report.md` (CRIT-001 recurrence batch); review `review-c9501ee29b923011` pre-commit **allow**; prior CRIT-004/`b0ca039` and CRIT-001/002/003 batches preserved |

#### Review / Correction Evidence

| Field | Value |
|-------|--------|
| Review lineage | `review-c9501ee29b923011` |
| Gate | pre-commit → **allow** |
| Whole commit raw | **73** (`56+17`) |
| Production/docs bytes | **unchanged** by remediation code and by this bookkeeping batch |
| Git state this batch | **untouched** (no stage/commit/test rerun) |

#### Behaviors confirmed after remediation (as recorded)

- Success-path Pixabay pick coverage split into four autonomous scenarios under default 5s
- Prior failure-path coverage and teardown/`rmWithRetry` guards retained
- No production `src/` changes; no timeout inflation
- CRIT-004 EXIF remediation (`b0ca039`) remains in force

### 5.6 — Final-verification remediation (CRIT-005 OpenSpec delta header)

Branch: `fix/pixabay-success-test-stability` @ HEAD **`e79db70`** (code unchanged). Mode: Strict TDD focused remediation after admitted FAIL verify (`verify-report.md`, `evidence_revision sha256:6f67dd4130a710b5d3a0ecf450fae7638756f39ad5e41fb78338554fdfb7e7c4` — CRIT-005). Prior FAIL history preserved — **not rewritten as PASS**.

**Syntax-only OpenSpec remediation**: one delta header rename. No production/test code. No Git commit/stage. No archive.

#### Root cause

**CRIT-005**: `openspec/changes/replace-unsplash-with-pixabay/specs/image-source-pixabay/spec.md` used `## Requirements` instead of the recognized delta section `## ADDED Requirements`. Strict OpenSpec validation exited **1** (`no delta sections found`), so the change omitted **8 requirements / 16 scenarios** from the delta parse. Runtime suite was already green; archive readiness was blocked by invalid delta structure.

#### Files

| File | Action |
|------|--------|
| `openspec/.../specs/image-source-pixabay/spec.md` | Modified — `## Requirements` → `## ADDED Requirements` (**1** line) |
| `openspec/.../tasks.md` | Modified — task 5.6 records remediation |
| `openspec/.../apply-progress.md` | Modified — this section |
| `openspec/.../remediation-report.md` | Modified — CRIT-005 remediation envelope + preserved priors |
| `openspec/.../verify-report.md` | **Unchanged** — admitted FAIL retained; fresh independent sdd-verify still required |

#### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.6 CRIT-005 | OpenSpec delta `image-source-pixabay/spec.md` | Spec artifact | ✅ sibling deltas already use `## ADDED Requirements` (`cli-runtime`, `image-selection`) | ✅ Independent verify FAIL: `npx openspec validate … --strict` exit 1 — no delta sections / 8 req + 16 scen omitted | ✅ `npm run openspec:validate -- replace-unsplash-with-pixabay` → exit **0**, `Change 'replace-unsplash-with-pixabay' is valid` | ➖ Single recognized header token; no behavior change | ➖ Header rename only |

#### Work Unit Evidence

| Evidence | Result |
|----------|--------|
| Focused validation command | `npm run openspec:validate -- replace-unsplash-with-pixabay` → exit **0**, `Change 'replace-unsplash-with-pixabay' is valid` (wrapper: `--strict --no-interactive`, telemetry off) |
| Runtime harness | **N/A** — OpenSpec delta syntax only; no CLI/HTTP/FS production boundary in this batch |
| Rollback boundary | Revert header in `specs/image-source-pixabay/spec.md` to `## Requirements`; revert tasks/apply-progress/remediation 5.6 notes. Leave `verify-report.md` untouched. |
| Authored line count | **1** delta header rename (+ bookkeeping). Code **0**. Under 400. No `size:exception`. |
| Commit status | **Not committed** — apply remediation only; code HEAD remains `e79db70` |
| Independent verify | **Still required** — do not self-PASS; prior admitted FAIL remains in `verify-report.md` |
| Remediation evidence | `remediation-report.md` (`fix_batch=final-verification-remediation-crit005`, `failed_evidence_revision=sha256:6f67dd4130a710b5d3a0ecf450fae7638756f39ad5e41fb78338554fdfb7e7c4`, lineage `review-c9501ee29b923011`); priors CRIT-001/002/003, CRIT-004, CRIT-001-recurrence preserved |

#### Behaviors confirmed after remediation

- Strict OpenSpec change validation parses the Pixabay capability delta
- No production `src/` or `test/` bytes modified
- Admitted FAIL `verify-report.md` bytes preserved unchanged
- Prior runtime remediations at `e79db70` / `b0ca039` remain in force

## Remaining

- Independent **sdd-verify** rerun only (must execute fresh full suite + OpenSpec validate + relevant evidence; do not archive / do not self-PASS from remediation-side runs)

## Status

**22/22** tasks complete including remediation 5.3 + 5.4 + 5.5 + **5.6** (WU1–WU5b3 + WU6a* + WU6b* + WU6c* + WU7 + 5.2 + 5.3 + 5.4 + 5.5 + **5.6**). Failed verify report preserved unchanged. CRIT-005 delta header fixed; code HEAD still `e79db70` (CRIT-001 recurrence); CRIT-004 remains at `b0ca039`. **Fresh independent sdd-verify is ready and still required** (not self-verified PASS).
