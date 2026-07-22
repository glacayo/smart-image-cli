# Proposal: Smart Image CLI (`img`)

## Intent

Client website images arrive messy: random names, wrong orientation, leaking EXIF/GPS, oversized, unlabeled. LLM coding agents need a globally installed console tool that turns a folder dump into a curated, queryable per-project library and produces slot-ready web assets — never upscaling or guessing.

## Stack Decision

Node.js 22 LTS + TypeScript (strict, ESM): `sharp`, `exiftool-vendored`, `better-sqlite3`, `commander.js`, `vitest`. Rationale: `sharp` is the only toolchain giving AVIF+WebP+JPG+PNG with zero external runtime deps on Windows-first targets. Go (CGO + libvips) is the documented fallback.

## Scope

### In Scope
- `analyze`: recursive scan, sha256 dedupe, AI classify, rename, **organize into category folders by default**, write index + sidecars.
- `optimize`: resize/crop, convert (jpg/png/webp/avif), strip metadata + ICC by default.
- `pick`/`mark-used`: match by category×orientation×dimensions, emit slot asset, record usage by free-text slot (e.g. `home.hero.slider`); **fail with close alternatives** when nothing qualifies.
- `list`/`stats`/`config`/`doctor`; shipped extendable category taxonomy; provider abstraction (Ollama Cloud default, OpenRouter + Gemini config-only).

### Out of Scope
- Image generation, cloud/team features, GUI/TUI, hosted service, animation.
- Single-binary SEA packaging — later PR; v1 ships via `npm i -g`.

## Capabilities

### New Capabilities
- `image-analysis`: scan, dedupe, AI classify, rename, organize-by-default, sidecars.
- `image-optimization`: resize/crop, format convert, strip metadata + ICC.
- `image-selection`: slot matching, free-text usage tracking, fail-with-alternatives (never upscale).
- `local-index`: `.img-ia/` SQLite + JSON sidecars, used-state, shipped/extendable taxonomy.
- `ai-provider`: OpenAI-compatible VisionProvider, structured JSON output, pre-send downscale, typed errors.
- `cli-runtime`: `img` binary, JSON/TTY output modes, stable exit codes, `config`/`doctor`.

### Modified Capabilities
- None (greenfield; `openspec/specs/` is empty).

## Approach

Layered CLI: `commander` shell → pipeline services (analyze/optimize/pick) → abstracted `sharp` image layer, `VisionProvider` AI layer, `better-sqlite3` index. Sidecars are the durable record; the DB is a rebuildable view. Side effects confined to `--root`; API keys stored per-user, never in the project.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| repo root | New | package.json, tsconfig, `src/` |
| `src/commands/` | New | analyze, optimize, pick, config, doctor |
| `src/index/`, `src/providers/` | New | SQLite + sidecars; provider adapters |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Pressure to upscale | High | Hard contract: fail + alternatives, never upscale |
| GPS/PII metadata leak | Med | Strip EXIF + ICC by default |
| Path escape / Windows path limits | Med | Absolute-resolve, reject `../` outside root, sanitize names |
| Provider rate limits on big folders | Med | Concurrency cap, sha256 cache, resumable batch |

## Rollback Plan

Greenfield — no production surface. Revert the change branch; no migration. Users uninstall via `npm rm -g smart-image-cli`. Per-project `.img-ia/` is gitignorable and disposable.

## Dependencies

- Configured AI provider endpoint + key (Ollama Cloud / OpenRouter / Gemini) — the only external runtime dependency.

## Success Criteria

- [ ] `analyze` yields renamed, organized, deduped images + a queryable index.
- [ ] `optimize` emits AVIF/WebP/JPG/PNG with metadata + ICC stripped.
- [ ] `pick` returns a JSON manifest on match, exit 2 + alternatives on no-match, never upscales.
- [ ] Usage recorded per free-text slot; the same image stays reusable in a different slot.
- [ ] JSON output + stable exit codes verified for agent consumption.
