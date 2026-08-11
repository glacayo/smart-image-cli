# Smart Image CLI — Agent Instructions

This repository builds `smart-image-cli`, exposed as the `smart-img` command.

Use these instructions as the project-level rules of the house. For detailed operational workflows, load the project skill:

```text
smart-image-cli
```

The portable skill lives at:

```text
.agents/skills/smart-image-cli/SKILL.md
```

## Core rules

- Never ask the user to paste API keys into chat.
- Never print, store, document, or commit API key values.
- Provider setup must be done by the human through the private CLI flow:

  ```bash
  smart-img config setup
  ```

- For this beta line, only `ollama` is end-to-end validated for real image analysis.
- Do not claim OpenRouter, Gemini, or any other provider works until it has install → configure → doctor → analyze evidence.
- Listing models is not enough; `provider-chat` must pass and `smart-img analyze` must work on real copied images.

## Customer image safety

- Treat customer originals as protected source material.
- For tests, copy a small sample into a sandbox first.
- Do not modify `CUSTOMER-IMAGES` unless the user explicitly chose that exact folder for organization.
- Prefer the narrowest correct image root instead of the whole website/project folder.
- `CUSTOMER-IMAGES/` is the canonical managed **working copy** where the human/agent copies customer images for smart-img; it is not the customer's only/original source archive. Run image-library commands against this narrow root.
- `analyze` may rename/move files inside this managed root into category folders. Use `--dry-run` to preview without writing.

Example preferred root:

```bash
smart-img analyze "./CUSTOMER-IMAGES"
```

## Filesystem convention

smart-img writes a predictable, command-dependent set of paths under the chosen root. Do not invent alternate roots, state folders, or output folders.

| Path | Created by | Purpose |
|------|-----------|---------|
| `<category>/` | `analyze` | Managed local library (organized images) |
| `.img-ia/config.json` | optional manual/`config set` | Project config; MUST NOT hold secrets |
| `.img-ia/index.sqlite` (+ WAL/SHM) | `analyze` | Derived queryable index (rebuildable from sidecars) |
| `.img-ia/sidecars/<sha>.json` | `analyze` | Durable per-image record (source of truth) |
| `.img-ia/usage.jsonl` | `pick`/`mark-used` | Usage journal (only after usage actions) |
| `.img-ia/pixabay/<id>.jpg` | `pick --source pixabay` | Downloaded Pixabay source |
| `.img-ia/pixabay/cache/<hash>.json` | `pick --source pixabay` | 24h search cache (key-stripped) |
| `.img-ia/pixabay/used-ids.jsonl` | `pick --source pixabay` | Used Pixabay ids per slot+location |
| `_out/<slug>[-NNN].<format>` | `optimize`, `pick` | Website-ready generated assets |

- `.img-ia/` is internal state; `_out/` is consumable output; category dirs are the managed local library.
- `.atl/` is a test/agent sandbox convention — smart-img never creates or reads it.
- No automatic local↔Pixabay fallback. No overwrite. No upscale. No general automatic cleanup of generated/cached files.
- The Pixabay manifest is returned in CLI output, not persisted as a separate file.
- Full per-path detail: `.agents/skills/smart-image-cli/SKILL.md` → Filesystem layout.

## Verification expectations

Before saying a CLI workflow works, verify with real commands and report evidence.

Useful gates:

```bash
npm test
npm run typecheck
npm run lint
npm run format
```

For provider/runtime validation, use:

```bash
smart-img doctor
smart-img analyze "<image-root>" --fail-fast
smart-img list "<image-root>"
smart-img stats "<image-root>"
```

When testing installation/uninstall, use an isolated sandbox and clean it afterward.

## Current known behavior

- Ollama image analysis uses native `POST /api/chat`.
- `doctor` checks provider config, endpoint, model, and chat/inference readiness.
- `analyze` ignores common dependency/build/generated folders such as `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.nuxt`, `vendor`, `.img-ia`, and `_out`.
- `pick` requires an existing analyzed/indexed library; if it returns `no_candidate`, inspect `smart-img list` and adjust constraints instead of inventing a result.
- `pick --source pixabay` is an explicit external stock-photo path, separate from the local index. `local` is the default; there is **no** automatic cross-source fallback either way. Requires `PIXABAY_API_KEY` env (operator override) **>** user-config `pixabay.apiKey` (set via private `smart-img config pixabay setup`). Search uses `image_type=photo` and `safesearch=true`; responses cache per project for 24h (key-free); already-used Pixabay ids for the same slot+location are skipped before a single download; no upscale (free-tier cap may succeed with a structured `resolution_cap` warning). Downloads are for combined-work / customer-website use only under the Pixabay Content License. See `docs/providers/pixabay.md` for the full contract.
- Pixabay is an image source, not an AI vision provider. Only Ollama is end-to-end validated for image analysis.

## Commit discipline

- Keep changes as small, reviewable work units.
- Keep tests with the behavior they verify.
- Do not add AI attribution to commits.
- Validate RDD/Gentle AI gates when enabled before committing or delivering.
