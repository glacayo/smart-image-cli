# Pixabay image source

Explicit external stock photos for `smart-img pick` via `--source pixabay`. Local index remains the default; there is **no** automatic fallback between sources.

## Quick path

1. Human obtains a key at [pixabay.com/api/docs](https://pixabay.com/api/docs/).
2. Human runs private setup (interactive TTY only):

   ```bash
   smart-img config pixabay setup
   ```

3. Pick with required query:

   ```bash
   smart-img --json pick ./assets \
     --source pixabay \
     --query "modern kitchen island" \
     --orientation landscape \
     --width 1600 \
     --height 900 \
     --slot home.hero
   ```

4. Expect one `_out` asset plus license metadata, or a structured failure (`missing_pixabay_credential`, `no_candidate`, `rate_limited`, …).

## Credentials

| Rule          | Detail                                                                             |
| ------------- | ---------------------------------------------------------------------------------- |
| Setup command | `smart-img config pixabay setup` — masked prompt, user-scoped config mode `0600`   |
| Precedence    | `PIXABAY_API_KEY` env **>** user-config `pixabay.apiKey`                           |
| Blocked       | `config set pixabay.*` (redirect to setup); no key via argv/chat/project config    |
| Missing key   | `pick --source pixabay` → reason `missing_pixabay_credential`, exit `4`, no HTTP   |
| Redaction     | Key never appears in `config list`, `doctor`, cache files, logs, or error messages |

Agents must never ask for, store, or echo the key. Non-TTY setup exits `3` with secret-free guidance.

## Search contract

| Constraint   | Value                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Flag         | `--source pixabay` (explicit only)                                                                        |
| Query        | `--query` required; composed `q` (query + unique categories) ≤ 100 chars                                  |
| `image_type` | Fixed `photo` (not configurable)                                                                          |
| `safesearch` | Default `true`; override with `--safesearch false`                                                        |
| Orientation  | `landscape`→API `horizontal`, `portrait`→`vertical`; `square`/`panorama` filtered locally by aspect ratio |
| Fallback     | None — failures never switch to `local` (or the reverse)                                                  |

## Cache and rate limits

- Per-project cache under `.img-ia/pixabay/cache/` for **24 hours**.
- Cache identity is the request URL **without** the `key` parameter; bodies never store the key.
- Cache IO failure is non-fatal (live request continues).
- HTTP **429** → reason `rate_limited`, exit `4`, **no automatic retry**.
- Rate headers (`X-RateLimit-*`) may appear on structured results/errors.

## Selection, download, and output

1. Filter hits by orientation band and requested size (no upscale).
2. Skip Pixabay ids already used for the same slot+location (id→sha index at `.img-ia/pixabay/used-ids.jsonl` intersected with usage).
3. Choose the smallest rendition that fits (`webformat` → `large` → optional `fullHD`/`imageURL`).
4. Download **exactly one** image into `.img-ia/pixabay/<id>.jpg`.
5. Resize/crop through Sharp into `_out` (never enlarge past source).
6. Record usage, then append used-id. Usage failure rolls back the `_out` asset (`usage_failed`, exit `5`).

If the account cannot deliver a requested size above the free tier (~1280px long edge) but a smaller source still fits, the pick **succeeds** with a structured `resolution_cap` warning instead of failing or upscaling.

## License and website-only use

Successful manifests include:

- `source: "pixabay"`
- `pixabayId`, `pageURL`, `contributor`
- `license: "Pixabay Content License"`
- `disclaimer`: combined-work use on the customer website only; **no standalone redistribution**; third-party rights may apply

Keep attribution/disclaimer with any published usage. Do not treat downloads as free-standing stock for resale or redistribution outside the customer site.

## Failures (stable exits)

| Reason                            | Exit | When                                                                                       |
| --------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `invalid_input`                   | 3    | Unknown/unsupported `--source`, missing/oversized query, bad `--safesearch`, non-TTY setup |
| `missing_pixabay_credential`      | 3    | `config set pixabay.*` blocked                                                             |
| `missing_pixabay_credential`      | 4    | Pick without env or user key                                                               |
| `no_candidate`                    | 2    | Nothing survives filters/dedupe/size                                                       |
| `rate_limited` / `provider_error` | 4    | 429 or transport/HTTP/JSON failure                                                         |
| `usage_failed`                    | 5    | Durable usage write failed after produce                                                   |

## Related

- README summary: project root `README.md` → “Picking from Pixabay”
- Agent runbook: `.agents/skills/smart-image-cli/SKILL.md` → Pixabay decision gate
- Vision providers (Ollama, etc.) are separate from this image source
