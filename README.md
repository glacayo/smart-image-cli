![Smart Image CLI banner](./smart-image-cli.png)

# Smart Image CLI

Agent-friendly CLI for analyzing, organizing, optimizing, resizing, and selecting website image assets from local project folders.

Smart Image CLI is designed for developers and AI coding agents that need to work with client-provided images without wasting time manually renaming, classifying, compressing, or resizing every file.

## Release status

Smart Image CLI is prepared as a `0.3.0` release candidate. `0.3.0` is not published yet; the package version is bumped to `0.3.0` in-tree pending publication, tagging, and release.

The validated workflow covers:

- private Ollama setup through `smart-img config setup`
- provider readiness checks with `smart-img doctor`
- real image analysis with Ollama native `POST /api/chat`
- local indexing and sidecars
- image listing, stats, optimization, picking, and usage tracking
- dependency/build directory ignores during recursive analysis
- explicit Pixabay stock-photo sourcing via `smart-img pick --source pixabay` (separate from the local index; no automatic fallback)

Only Ollama is end-to-end validated for image analysis in this release. OpenRouter, Gemini, and other provider presets should be treated as experimental until they pass the same install → configure → doctor → analyze workflow. Pixabay is an explicit external image source, not an AI vision provider.

> **Migration note:** `img` is a temporary **failing** migration stub that prints a redirect message to stderr and exits non-zero; it does not run any CLI functionality. `smart-img` is the only functional command in `smart-image-cli@0.3.0`.

## What it does

- Analyze image folders recursively with AI.
- Rename and organize images by detected category inside the chosen root.
- Store local metadata and indexes inside the image root under `.img-ia/`.
- Optimize images for web delivery into `_out/`.
- Resize and crop images for website slots.
- Select the best available image for a requested section from the local index or Pixabay.
- Track where images were used so agents avoid repeating assets in the same slot.

## Provider setup and model selection

Configure a vision provider once in **user-scoped** config (never commit API keys to the project):

```bash
# Interactive (TTY): provider → API key → connection test → model list → save
smart-img config setup

# Non-interactive / agents (no prompts; pass flags before the setup action)
smart-img --json config --provider ollama --api-key "$OLLAMA_API_KEY" --model minimax-m3 setup

# List discoverable models (metadata-only GET /models; no image spend)
smart-img --json config models --provider ollama

# Diagnostics: runtime deps + active provider endpoint/model/chat reachability
smart-img --json doctor
```

Notes:

- Provider presets exist for `ollama`, `openrouter`, and `gemini`, but a provider should only be treated as usable after `doctor` passes and a real `analyze` flow succeeds. Listing models alone is not enough.
- Ollama is the first provider targeted for end-to-end validation in this beta line. The CLI uses Ollama's native `POST /api/chat` route for image analysis; an API key must be able to run inference, not only list models. Do not promise the same guarantee for OpenRouter or Gemini until they have the same install → configure → analyze test evidence.
- Optional flags: `--endpoint`, `--yes` (accept non-vision model warnings without confirm).
- `config set` of an API key triggers a connection test; keys are redacted in all CLI output.
- `doctor` reports `provider-config`, `provider-endpoint`, `provider-model`, and `provider-chat`. For Ollama, the chat check uses the same native `POST /api/chat` route that `analyze` depends on, so it can catch keys that list models but cannot run inference.
- Subsequent `analyze` / AI `pick` reuse the persisted user selection automatically.

## Picking images with semantic intent

`smart-img pick` can select from the existing local index with structured constraints and, when `--query` is present, rank only the constraint-eligible candidates by metadata.

```bash
smart-img --json pick ./assets --category bathroom --query "bright naturally lit shower"
smart-img --json pick ./assets --category bathroom --query "bright shower" --semantic ai --top-k 5
```

- `--query <text>` enables intent ranking over indexed metadata (`subject`, `title`, `description`, `altText`, and `categories`).
- `--source local|pixabay` selects the image source. `local` is the default; Pixabay is explicit only — never an automatic fallback either way.
- `--semantic local|ai` selects the ranker. Omitted `--semantic` defaults to `local` and emits a non-fatal stderr note.
- `--top-k <1..10>` bounds emitted ranking alternatives; the default is `3`.
- Local mode is deterministic, requires no provider, and is the default to avoid hidden spend.
- AI mode is explicit only and sends metadata text to the configured provider. It does not send image bytes, re-read images for ranking, or re-analyze images.
- AI ranking failures return structured `ai_ranking_failed` output with provider-error exit code `4`; there is no silent local fallback.

### Picking from Pixabay

Use Pixabay only when the user or agent **explicitly** wants a stock photo instead of the local index (`--source pixabay`). Full details: [`docs/providers/pixabay.md`](./docs/providers/pixabay.md).

1. Human obtains an API key at **https://pixabay.com/api/docs/**.
2. Human runs private setup once (interactive TTY only; no key via argv/chat):

   ```bash
   smart-img config pixabay setup
   ```

3. Agent picks with an explicit source and required `--query`:

   ```bash
   smart-img --json pick ./assets \
     --source pixabay \
     --query "modern spa bathroom hero" \
     --orientation landscape \
     --width 1600 \
     --height 900 \
     --slot home.hero
   ```

Key constraints:

- Credential: `PIXABAY_API_KEY` env (operator override) **>** user-config `pixabay.apiKey`. Missing key → `missing_pixabay_credential` (exit 4). Never in project config, argv, logs, cache, or errors.
- Search: `image_type=photo` (fixed), `safesearch=true` by default (`--safesearch false` to disable), composed `q` ≤ 100 chars.
- Cache: 24h per-project under `.img-ia/pixabay/cache/` (key stripped from identity/body). HTTP 429 → `rate_limited`, no auto-retry.
- One download per successful pick; already-used Pixabay ids for the slot+location are skipped before download.
- No upscale; free-tier cap may succeed with a structured `resolution_cap` warning. Output under `_out`; source under `.img-ia/pixabay/`.
- Manifest: Pixabay page URL, contributor, `Pixabay Content License`, combined-work / website-only disclaimer (no standalone redistribution).

## Filesystem layout

Run `smart-img` against a narrow image-only root such as `./CUSTOMER-IMAGES` (the managed working copy where you copy customer images for the tool), not the whole website. `analyze` may rename/move files inside that root into category folders; use `--dry-run` to preview.

| Path | Created by | Purpose |
|------|-----------|---------|
| `<category>/` | `analyze` | Organized local library |
| `.img-ia/config.json` | optional | Project config (no secrets) |
| `.img-ia/index.sqlite` (+ WAL/SHM) | `analyze` | Queryable derived index |
| `.img-ia/sidecars/<sha>.json` | `analyze` | Durable per-image record (source of truth) |
| `.img-ia/usage.jsonl` | `pick`/`mark-used` | Usage journal |
| `.img-ia/pixabay/<id>.jpg` | `pick --source pixabay` | Downloaded Pixabay source |
| `.img-ia/pixabay/cache/<hash>.json` | `pick --source pixabay` | 24h search cache (key-stripped) |
| `_out/<slug>[-NNN].<format>` | `optimize`, `pick` | Website-ready output |

- `.img-ia/` is internal state; `_out/` is consumable output; category dirs are the managed local library.
- No automatic local↔Pixabay fallback, no overwrite, no upscale, no automatic cleanup.
- The Pixabay manifest is returned in CLI output, not persisted as a file.

## Planned stack

| Concern          | Choice                 |
| ---------------- | ---------------------- |
| Runtime          | Node.js 22+            |
| Language         | TypeScript / ESM       |
| CLI              | Commander              |
| Image processing | Sharp                  |
| Metadata         | exiftool-vendored      |
| Local index      | SQLite + JSON sidecars |
| Testing          | Vitest                 |

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

OpenSpec archive validation is run manually with `npm run openspec:validate -- <change>`; it is a standalone SDD/archive gate, not part of the default build/test commands. The project wrapper disables OpenSpec telemetry for validation (`OPENSPEC_TELEMETRY=0`, `DO_NOT_TRACK=1`). `openspec list` may still report legacy `openspec/config.yaml` rules-format warnings for `apply`/`verify`; those warnings pre-date the semantic pick query change and are out of scope for this warning-cleanup chore.

## Roadmap

1. Publish the first package release.
2. Explicit external image sourcing via Pixabay (`--source pixabay`) is implemented; keep docs and terms compliance current.
3. Validate additional vision providers only after they pass the full install → configure → doctor → analyze workflow.
