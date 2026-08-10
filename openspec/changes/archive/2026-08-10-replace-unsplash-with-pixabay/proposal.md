# Proposal: Replace Unsplash with Pixabay

## Intent

Unsplash terms mandate permanent hotlinking, incompatible with this CLI's
download → transform → `.img-ia`/`_out` → serve-from-customer-site pipeline.
Pixabay permits local download and rehosting. Unsplash never shipped, so it is
removed outright, not migrated.

## Scope

### In Scope

- Remove all Unsplash code, config, tests, docs, and `--source unsplash`.
- Pixabay BYOK through a private masked prompt; agents never handle keys.
- Search: key required, `q` ≤ 100 chars, `image_type=photo`, `safesearch=true` (configurable).
- 24h response cache keyed without the key; `X-RateLimit-*` parsing and 429 handling.
- Orientation: landscape→`horizontal`, portrait→`vertical`; square/panorama filtered locally by aspect ratio.
- Dedupe by Pixabay `id`, then download exactly one image.
- Renditions up to ~1280; use `fullHDURL`/`imageURL` when exposed; never upscale. Above 1280 without full access, deliver best available with a structured resolution-cap warning.
- Source/license/contributor/disclaimer metadata on produced assets.
- Docs: README summary, canonical `docs/providers/pixabay.md`, project skill.

### Out of Scope

- Generic `ImageSource` abstraction (defer to a second provider).
- Migrating `unsplash.accessKey` or deleting existing `.img-ia/unsplash/` files.
- Automatic fallback — `--source pixabay` is always explicit.
- Standalone redistribution.

## Capabilities

### New Capabilities

- `image-source-pixabay`: BYOK setup, key-required search, 24h cache, rate-limit compliance, orientation mapping, id-dedupe single download, rendition ladder with resolution-cap warning, license metadata.

### Modified Capabilities

- `image-selection`: `--source` becomes `local|pixabay`; No Upscaling extends to Pixabay renditions.
- `cli-runtime`: `--source unsplash` returns `invalid_input` (exit 3), never a silent fallback; `PIXABAY_API_KEY` override and `doctor` never expose the key.

## Approach

In-place replacement (exploration Approach 1): reuse the reviewed BYOK setup, resolver,
and `config set` guard; add Pixabay transport (query-string key, cache, rate headers,
rendition ladder). No new abstraction.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/adapters/unsplash-client.ts` | Removed | Replaced by `pixabay-client.ts` |
| `src/adapters/pixabay-response-cache.ts` | New | 24h TTL, key-stripped |
| `src/app/{config,runtime,pick}-service.ts` | Modified | BYOK, resolver, pick flow |
| `src/{commands,config}/*` | Modified | `--source pixabay`, `pixabayConfigSchema` |
| README, skill, `docs/providers/pixabay.md` | Modified/New | Provider docs |
| `test/**/*unsplash*` | Removed | Pixabay equivalents |

## Delivery

`auto-chain`, 400-line review budget, strict TDD. Work units: config/setup →
client+cache → pick flow → removal+docs.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Key leaks via query-string URL | High | Redaction tests; cache strips `key`; never log raw URL |
| Wrong 24h TTL violates terms | Med | TTL and no-key-in-cache tests |
| Rendition ladder upscales | Med | Discover fields from response; test both cases |
| Removal unit exceeds 400 lines | Med | Sequence removal last; split docs from code |

## Rollback Plan

Each work unit is an independent PR; revert its merge commit. Unsplash stays green
until the final removal unit.

## Dependencies

- Official Pixabay API docs, license summary, and terms.
- Per-developer, human-provided Pixabay API key.

## Success Criteria

- [ ] No `unsplash` identifier in `src/`, `test/`, `docs/`, README, or skill.
- [ ] `--source pixabay` writes one `_out` asset with license metadata.
- [ ] No `key=` value in cache files or error output.
- [ ] 429 and resolution-cap paths return structured reasons.
- [ ] `npm test`, typecheck, lint, format pass.
