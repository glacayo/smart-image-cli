# Image Source: Pixabay Specification

## Purpose

Provide a single explicit external image source, Pixabay, for `pick`, replacing the never-shipped Unsplash integration: per-developer BYOK credentials, terms-compliant caching and rate limiting, locally-derived orientation filtering, id-based dedup, a bounded no-upscale rendition ladder, and license-compliant local storage for combined-work use only.

## ADDED Requirements

### Requirement: Pixabay BYOK Setup

The system MUST provide `smart-img config pixabay setup`, a private masked interactive prompt that persists the API key to user-scoped config at mode `0600` and never echoes the value. Non-interactive/non-TTY invocations MUST be rejected with actionable, secret-free guidance instead of prompting. Generic `config set pixabay.apiKey <value>` MUST be blocked with reason `missing_pixabay_credential` and the invalid-input exit code, directing the user to the setup command.

#### Scenario: Interactive setup persists the key privately

- GIVEN a TTY session with no configured Pixabay key
- WHEN the developer runs `smart-img config pixabay setup` and enters a key
- THEN the key is persisted to user-scoped config at mode `0600`
- AND the key is never echoed in stdout, stderr, or the result

#### Scenario: Non-interactive setup is rejected, not silently skipped

- GIVEN a non-TTY invocation of `config pixabay setup`
- WHEN the command runs
- THEN it exits with the invalid-input code and secret-free setup guidance
- AND no prompt is attempted

### Requirement: Pixabay API Key Required and Protected

Every Pixabay search request MUST include a valid key. A missing key MUST fail with reason `missing_pixabay_credential` and the provider-error exit code. Credential resolution MUST prefer the operator-managed `PIXABAY_API_KEY` environment override over the per-developer user-config key. The key MUST NOT appear in CLI argument echoes, project-scoped config, log/stderr output, the response cache, or any thrown/error message.

#### Scenario: Missing credential fails loudly before any request

- GIVEN no `PIXABAY_API_KEY` env var and no configured user-config key
- WHEN `pick --source pixabay` runs
- THEN it exits with the provider-error code and reason `missing_pixabay_credential`
- AND no Pixabay HTTP request is made

#### Scenario: Key never leaks across surfaces

- GIVEN a configured Pixabay key and a request that fails with an HTTP error
- WHEN the error, cache, or project config is inspected
- THEN none of them contain the raw key value
- AND `PIXABAY_API_KEY`, when set, takes precedence over the user-config key

### Requirement: Search Request Shape

The system MUST shape every Pixabay search request per these constraints:

| Constraint | Value |
|---|---|
| `q` length | over 100 characters MUST be rejected as invalid input |
| `image_type` | fixed `photo`, not configurable |
| `safesearch` | defaults to `true`; configurable via flag |
| orientation | `landscape`→`horizontal`, `portrait`→`vertical`; `square`/`panorama` have no Pixabay API equivalent and MUST be filtered locally from response `imageWidth`/`imageHeight` |

#### Scenario: Valid search applies default constraints

- GIVEN `pick --source pixabay --query "kitchen" --orientation landscape`
- WHEN the search request is built
- THEN it sends `image_type=photo`, `safesearch=true`, and `orientation=horizontal`

#### Scenario: Oversized query rejected before any request

- GIVEN a `--query` longer than 100 characters
- WHEN `pick --source pixabay` runs
- THEN it exits with the invalid-input code and no Pixabay request is made

### Requirement: 24h Response Cache and Rate-Limit Compliance

Search responses MUST be cached per-project for 24 hours, keyed by the request URL with the `key` parameter excluded, and MUST NOT persist the key in the cached key or body. A cache read/write failure MUST NOT fail the command; the system MUST fall back to a live request. The system MUST parse `X-RateLimit-Limit/Remaining/Reset` and map HTTP 429 to reason `rate_limited` with the provider-error exit code, without automatic retry storms.

#### Scenario: Fresh cache avoids a duplicate request

- GIVEN a cached response for the same key-excluded request URL less than 24h old
- WHEN the same search runs again
- THEN no new HTTP request is made and the cached hits are returned

#### Scenario: Stale cache triggers a refetch

- GIVEN a cached response older than 24h
- WHEN the same search runs
- THEN a new HTTP request is made and the cache is refreshed

#### Scenario: 429 returns a structured, non-retrying result

- GIVEN Pixabay responds with HTTP 429
- WHEN the search request completes
- THEN the command exits with the provider-error code and reason `rate_limited`
- AND no additional request is retried automatically

### Requirement: Usage Dedup by Pixabay ID Before Single Download

The system MUST map each Pixabay `id` used for a slot+location to its recorded usage SHA and MUST skip candidates whose `id` is already used for that slot+location without fetching their bytes. Exactly one image MUST be downloaded per successful pick.

#### Scenario: Already-used id skipped without download

- GIVEN a Pixabay id already recorded as used for the requested slot and location
- WHEN `pick --source pixabay` searches
- THEN that id is excluded from candidates before any download attempt

#### Scenario: Exactly one download for the selected candidate

- GIVEN an eligible, unused Pixabay id
- WHEN `pick --source pixabay` selects it
- THEN exactly one image is downloaded for that pick

### Requirement: Rendition Selection Without Upscaling

The system MUST select the smallest rendition satisfying the request without upscaling, using `largeImageURL` (~1280px) by default. When Full API Access exposes `fullHDURL`/`imageURL`, the ladder MUST extend up to the source image's actual dimensions, never beyond. When a request exceeds 1280px and Full API Access is unavailable, the pick MUST still succeed, delivering the best available rendition with a structured resolution-cap warning in the result rather than failing.

#### Scenario: Full-access ladder respects source dimensions

- GIVEN Full API Access exposing `fullHDURL`/`imageURL` and a request larger than 1280px but within source dimensions
- WHEN `pick --source pixabay` runs
- THEN the delivered rendition satisfies the request without exceeding the source's native size

#### Scenario: Capped access still succeeds, with a warning

- GIVEN no Full API Access and a request larger than 1280px
- WHEN `pick --source pixabay` runs
- THEN the pick succeeds with the best available (≤1280px) rendition
- AND the result includes a structured resolution-cap warning field

### Requirement: Local Storage, License Metadata, and Redistribution Constraint

The produced asset's manifest MUST record the Pixabay source page URL, contributor (user) attribution, and a standalone-redistribution-prohibited disclaimer; downloaded images are for combined-work use on the customer site only. If durable usage recording fails after Sharp produces the `_out` asset, the system MUST roll back (delete) the produced asset and return reason `usage_failed` with the filesystem-error exit code, mirroring the local-source rollback behavior.

#### Scenario: Successful pick records license metadata

- GIVEN a successful `pick --source pixabay`
- WHEN the manifest is emitted
- THEN it includes the Pixabay page URL, contributor attribution, and a redistribution-prohibited disclaimer

#### Scenario: Produced asset rolled back on usage-recording failure

- GIVEN the Sharp-produced `_out` asset exists but durable usage recording fails
- WHEN the failure is detected
- THEN the produced asset is deleted
- AND the result reports reason `usage_failed` with the filesystem-error exit code

### Requirement: Documentation Coverage

README, `docs/providers/pixabay.md`, and the project skill MUST document BYOK setup, the explicit-only `--source pixabay` flag, the 24h cache and rate-limit behavior, and the combined-work-only/no-standalone-redistribution constraint.

#### Scenario: Provider doc covers all externally observable constraints

- GIVEN a developer reading `docs/providers/pixabay.md`
- WHEN they look for setup, caching, and license behavior
- THEN all three are documented with no reference to Unsplash
