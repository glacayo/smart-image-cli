# Exploration: smart-image-cli

> Greenfield project. OpenSpec initialized at `openspec/config.yaml`. No source code, no git, no stack chosen yet. This exploration compares languages, image toolchains, AI provider abstractions, and local index strategies; it ends with a recommended next step into the proposal phase.

## 1. Product / Domain Understanding

### What the product is
A globally installed **console tool** that an LLM coding agent (Codex, OpenCode, Claude Code, Gemini CLI, etc.) can shell out to in order to manage the website images a client hands over. The agent is the **user**; humans don't drive it directly during a normal session. That changes a lot of decisions:

- Output must be **agent-friendly**: structured JSON for results, stable exit codes, predictable stdout/stderr separation, no interactive prompts by default.
- Operations must be **idempotent** and **safe to re-run** on the same project, because an agent may call a tool several times while iterating.
- The tool owns its **side effects** to one project folder at a time (no global state) and never touches anything outside the given `--root`.
- Errors must be **loud and specific** so the agent can react (e.g. "no image matches the requested slot" must be a non-zero exit with a structured error, not a degraded guess).

### Core problem domain
Client images are almost always a **mess**: random filenames, wrong orientation, mixed categories, EXIF/GPS data leaking, oversized for the web, and a domain taxonomy the client never labeled. The tool needs to convert that into a **curated, queryable library** that a website can draw from, with three distinct responsibilities:

1. **Ingest + understand** — recursively walk a folder, identify each image (subject, orientation, suggested category, alt text, title, description), rename to a unique stable slug, and classify into one or more category folders.
2. **Index + serve** — keep a per-folder local index so future "give me a hero image for kitchen remodeling" calls are fast and don't re-ask the AI for every image.
3. **Produce** — for a specific slot (slider 1800x980, hero, thumbnail, gallery tile, etc.), pick only images that match the constraints, output in the requested format (JPG / PNG / AVIF / WEBP), with metadata stripped and weight reduced. **Refuse to upsell** an unfit image — fail loudly instead.

### System boundaries
- **Inside the boundary** (per project): walk folders, read pixels, talk to one AI provider, read/write a per-folder index (SQLite + small JSON sidecars), rename/move/copy/optimize/resize, emit final assets.
- **Outside the boundary**: the website itself, the agent that calls us, any global state, network services other than the configured AI provider, system-wide installs. Per requirements, indexes and usage tracking live **inside the project folder**; the tool is stateless across projects.
- **AI provider is the only external dependency** at runtime, and its endpoint + API key come from a per-install or per-project config. Nothing is hardcoded.

### Primary user flows
1. **Initial ingest.** Agent runs `img analyze <root>` once on a fresh client folder dump. Tool scans recursively, deduplicates, renames, classifies, writes index.
2. **Optimize on demand.** Agent runs `img optimize <root> <file...> --format avif --strip-metadata --quality 80`.
3. **Pick for a slot.** Agent runs `img pick <root> --category kitchen-remodeling --orientation landscape --slot hero --width 1800 --height 980 --format webp` and gets a JSON manifest pointing to the produced files (or a typed "no-match" error).
4. **Mark used.** Successful pick records the (file, slot, location) in the index so the same image won't be auto-suggested for the same slot again but stays eligible for other slots/sections.
5. **Config.** First run, or `img config`, sets the AI provider, model, API key, and any provider-specific knobs; persists locally.

### Out of scope (to lock in the proposal)
- Image generation (this is a manager, not a creator).
- Cloud sync, sharing, or team features.
- A GUI or TUI.
- A hosted service. Everything runs locally against the configured AI endpoint.

---

## 2. Recommended Stack and Why

### Decision drivers
- **Windows first**, Linux/macOS second → primary target needs a clean Windows install story with no system-wide dependencies.
- **Globally installable as a single binary** (per the "globally installed console tool" requirement) → strong cross-compile story matters.
- **AVIF + WebP + JPG + PNG** encode/decode for resize/optimize is a hard requirement.
- **AI provider abstraction** over Ollama Cloud / OpenRouter / Gemini → all three are OpenAI-compatible, so we need a portable HTTP client, not a vendor-specific SDK.
- **Per-folder local index** with efficient queries (category × orientation × dimensions × used-state) → SQLite is the natural fit.
- **Agent-friendly CLI** with subcommands, JSON output, predictable exit codes.

### Options compared

| Option | Language / runtime | Image toolchain fit | Cross-platform distribution | AI HTTP integration | CLI ergonomics | Verdict |
|---|---|---|---|---|---|---|
| **A. Node.js + TypeScript** | Node 22 LTS or Node 24 | `sharp` (libvips) ships **prebuilt Windows binaries** with AVIF/WebP/JPG/PNG/TIFF/SVG. Resize, smart crop, strip metadata, format convert — all native and fast. | `pkg` is **archived/deprecated** as of v5.8.1; native Node SEA exists since Node 21 but **cross-compile requires per-platform CI** (`useCodeCache` and `useSnapshot` must be `false` when generating for a different OS). Still works, but heavier than Go. | Native `fetch` in Node 22+, OpenAI-compatible clients trivial; `exiftool-vendored` ships a Windows `.exe` standalone. | `commander.js` is mature; `tsx` for dev; built-in test runner + `vitest` available. | Strong on image + AI + CLI. Weaker on single-binary distribution than Go. |
| **B. Go** | Go 1.25/1.26 | Two paths: pure Go (`github.com/disintegration/imaging`) is **JPEG/PNG only — no AVIF, no WebP**. So we'd need **`github.com/h2non/bimg` (CGO + libvips)** for AVIF/WebP. That means **libvips must be installed on the target Windows machine** OR we must ship the libvips DLLs alongside the binary. Doable, but materially more work. | **Best-in-class** cross-compile: `GOOS=windows GOARCH=amd64 go build` from any host. Static, single binary. | `net/http` is enough. AI clients are thin wrappers. | `spf13/cobra` is the standard. | Best distribution story, hardest image story. |
| **C. Python** | Python 3.12/3.13/3.14 | `Pillow` 12 has AVIF/WebP via prebuilt wheels on Windows. The catch: client must have a compatible Python on PATH or we ship via PyInstaller, which is **slow to build, slow to start, and bloated** for a CLI. Pure Go and Node SEA both beat it for binary distribution. | PyInstaller/Briefcase work but are noticeably heavier than Go binaries or Node SEA. Mature `pip install` for devs, painful for non-devs. | `openai`, `httpx`, `requests` are all fine; `pyexiftool` for metadata. | `typer` or `click` are good; arg parsing in `argparse` is fine. | Best for libraries, weakest for "globally installable single tool" on Windows. |

### Recommendation
**Node.js 22 LTS + TypeScript** is the right primary choice for this tool, and here's why it wins on the *specific* axis the user cares about most:

1. **`sharp` is the only image library that gives us AVIF + WebP + JPG + PNG with zero external runtime dependencies on Windows.** Prebuilt libvips binaries are published for Windows x64 / x86 / ARM64. The user runs `npm i -g smart-image-cli` and gets a working tool — no vips install, no DLL bundling, no MSVC redistributable hunt. Go's `imaging` package is JPEG/PNG only, which kills the requirement immediately; `bimg` requires libvips to be on the target machine or shipped alongside, and Go's CGO cross-compile to Windows is a recurring pain.
2. **`exiftool-vendored` ships a standalone Windows exiftool executable** in `node_modules`, so metadata stripping also needs zero system install. This is the second major "no-system-install" win on Windows.
3. **The AI provider layer is a 60-line wrapper over `fetch` and the OpenAI-compatible Chat Completions schema.** Ollama Cloud, OpenRouter, and Gemini all expose that schema. We don't need a vendor SDK.
4. **better-sqlite3 has prebuilt Windows binaries** and a synchronous API that fits a CLI tool's "read index, pick, write index" flow perfectly.
5. **Node 22 SEA + a small `postject` + `signtool` step in CI** is enough to ship a single `.exe` once we're ready to graduate from `npm i -g`. We can keep that as a future PR — `npm i -g` is the supported install path for v1.

**Go is the runner-up** and we should keep the architecture shaped so the image and AI layers are abstracted behind interfaces. If at some point in the future we want a true single-binary Windows distribution without a Node install step, we could reimplement the same interfaces in Go. The proposal should call this out as a non-goal for v1 but a design constraint.

**Python is not a fit** for a Windows-first globally installed console tool aimed at non-Python developers.

### Tooling and conventions
- **Runtime**: Node 22 LTS (current, in support until 2027-04-30; matches the 2026 horizon and the env's "Node 24 available" note).
- **Language**: TypeScript strict mode, ESM.
- **CLI framework**: `commander.js` (mature, well-known, subcommand-friendly).
- **Test runner**: `vitest` (fast ESM, watch mode, no transpiler config hell). `strict_tdd: false` stays in `config.yaml` until the first test file lands, then we flip it to `true` and the `test_command` to `vitest run`.
- **Linter / formatter**: `eslint` (typescript-eslint flat config) + `prettier`. Both are zero-config defaults for our style.
- **Type checker**: `tsc --noEmit` in CI.
- **Build**: `tsc` for type check; ship as plain JS via `package.json` `bin` field for v1.
- **Distribution (v1)**: `npm i -g smart-image-cli` (works on Windows PowerShell, macOS, Linux).
- **Distribution (later, optional)**: Node SEA + `postject` per platform via GitHub Actions matrix.

---

## 3. Recommended Image Processing Toolchain (Windows-first)

| Concern | Library | Why this one | Windows story |
|---|---|---|---|
| Resize, convert, format, strip color profile | **`sharp`** (libvips binding) | Prebuilt Windows binaries, fast, single dep. JPG/PNG/WebP/AVIF/TIFF/GIF/SVG input; JPG/PNG/WebP/AVIF/GIF/TIFF output. `withMetadata({ exif: {} })`, `keepIccProfile`, `rotate()` for EXIF orientation. | Prebuilt. No vips install. |
| EXIF/XMP/IPTC strip, including GPS | **`exiftool-vendored`** | Bundles Phil Harvey's exiftool binary for win32-x64 (and others). `exiftool.deleteAllTags(file)` removes every metadata group in one call. Falls back to a long-running exiftool process for batch use. | Bundled `.exe` inside the package — zero install for the user. |
| EXIF orientation aware resize | `sharp.rotate()` (auto from EXIF) | `sharp` reads EXIF orientation and applies it during decode; the user can't accidentally upload a sideways photo. | Same as sharp. |
| Smart crop to a slot's aspect ratio | `sharp.extract({ left, top, width, height })` + `resize.cover()` | We compute the crop window (or use `attention`/`entropy`-based strategies) then encode. | Same. |
| Animation? | Skip for v1 | Slider, hero, gallery — all static. Animation support can be a later v1.x. | n/a |

### Format guidance baked into defaults
- **JPG**: `quality 82, mozjpeg, progressive, strip metadata`. Default for photos.
- **WebP**: `quality 80, effort 4`. Default for web rendering when the slot allows it.
- **AVIF**: `quality 60, effort 4`. Default for "give me the smallest" requests.
- **PNG**: only when alpha is required and a slot explicitly asks for it.

### Stripping-metadata contract
Always strip by default for `optimize` and `pick`. For `analyze` we keep a small **sidecar** JSON per image with our AI-inferred fields (subject, category, orientation, alt, title, description, sha256, dimensions, original filename) so the image's metadata can be wiped clean without losing our work. That sidecar is what the index queries — not the image file's EXIF.

---

## 4. AI Provider Abstraction + First Provider

### Abstraction shape
Because **Ollama Cloud, OpenRouter, and Google Gemini are all OpenAI-compatible at `/chat/completions`**, we don't need a pluggable SDK per provider. We need a single `VisionProvider` interface with one method, `analyze(image, prompt) -> ParsedAnalysis`, and three thin adapters that each set:

- `baseURL`
- `Authorization` header (bearer key, except Ollama local which uses "ollama" as a placeholder)
- `defaultModel`
- a tiny list of provider-specific knobs (Gemini may need `?key=...` query param depending on the path; OpenRouter wants `HTTP-Referer` and `X-Title` for the leaderboard).

```ts
interface VisionProvider {
  readonly id: 'ollama' | 'openrouter' | 'gemini';
  analyze(input: { imageBytes: Buffer; mimeType: string; prompt: string }): Promise<Analysis>;
}
```

That keeps the call site (analyzer pipeline, batch runner) provider-agnostic and lets us unit-test the analyzer with a `FakeProvider` returning canned JSON.

### Structured output contract
We always ask the model for **JSON only** with a strict schema (we control the prompt and parse the response). The JSON shape is the single source of truth for what an "analyzed image" looks like:

```jsonc
{
  "subject": "granite countertop with white cabinets",
  "categories": ["kitchen-remodeling", "countertops"],
  "orientation": "landscape",         // landscape | portrait | square
  "alt": "Newly installed white shaker cabinets with a gray granite countertop.",
  "title": "Modern White Kitchen Remodel",
  "description": "Two-line descriptive sentence suitable for a hero caption.",
  "suggestedFilename": "kitchen-remodeling-white-cabinets-granite-001",
  "confidence": 0.86
}
```

Categories come from a fixed vocabulary we ship (kitchen-remodeling, bathroom-remodeling, basement-remodeling, interior-painting, exterior-painting, flooring, roofing, …) plus a way to extend it. We do not let the model invent the taxonomy; we hand it the list and force it to pick.

### First-provider strategy
**Ship Ollama Cloud as the default, with OpenRouter and Gemini as configured alternatives.** Reasons:

1. **Lowest friction for a developer audience**: Ollama Cloud has a free tier, signing in is one step, and the same `OPENAI_BASE_URL=https://ollama.com/v1` works for both local Ollama and Ollama Cloud — so a developer who already runs Ollama locally can test without an API key.
2. **OpenAI-compatible endpoint means our `VisionProvider` is a one-liner against it** (`baseURL: 'https://ollama.com/v1'`, `apiKey: env.OLLAMA_API_KEY`).
3. **Model choice is now a config value**, not a code change. `qwen3-vl:8b` and `gemma3:27b` both handle the kind of image classification + alt-text generation we need and are available on Ollama Cloud. The proposal can pick a default and the config can override.
4. **OpenRouter becomes a "one key, many models" escape hatch** for users who want to swap to a specific vision model without onboarding with a new provider.
5. **Gemini is a fast path for users already in Google Cloud**; we keep it as a config-only option in v1 (no separate adapter code beyond the base URL swap).

### Config surface
- `img config set provider ollama-cloud`
- `img config set model qwen3-vl:8b`
- `img config set apiKey <key>` (writes to a **per-user** config file under OS user config dir, never committed)
- Optional **per-project** override file (`.img-ia.json` at the project root) for projects that need a different model or key

### Caveats the proposal must call out
- **Image input size**: vision models downscale or reject very large inputs. We must downscale to a sane size (e.g. longest edge 1024px) **before** sending, regardless of provider, and we never send the original 8MB JPEG.
- **Latency + cost**: batch analyses should support concurrency limits, a per-folder cache (we already plan this), and a `--dry-run` mode.
- **Failure modes**: provider timeouts, rate limits, malformed JSON, refusal to answer. All of these must surface as typed errors the agent can react to.

---

## 5. Recommended Local Index Format and Folder Metadata

### Storage choice
**SQLite via `better-sqlite3`** for the queryable index, plus **one tiny JSON sidecar per image** for fields we want to keep stable even if the DB is rebuilt.

- SQLite because: single file inside the project (portable, gitignorable, can be regenerated from sidecars); synchronous API fits a CLI's linear flow; prebuilt Windows binaries; zero install.
- Sidecars because: they are the **durable record**. The DB is a derived view. If anything corrupts the DB, we can drop it and rebuild from the sidecars + the original files.

### Layout inside the project root
```
<root>/
├── .img-ia/
│   ├── index.sqlite            # all queryable state
│   ├── sidecars/
│   │   └── <sha256>.json       # one per analyzed image
│   ├── usage.sqlite            # separate file, or same DB with separate tables — see below
│   ├── thumbnails/
│   │   └── <sha256>.webp       # small (320px) preview for picking UX
│   └── config.json             # per-project overrides (provider, model, slot presets)
├── kitchen-remodeling/         # category folders the tool created
│   ├── 0001-white-cabinets-granite-countertop.jpg
│   ├── 0002-island-pendant-lights.jpg
│   └── …
├── bathroom-remodeling/
│   └── …
└── (originals)                 # either moved into category folders or left in place
```

### Schema (initial)
```sql
CREATE TABLE image (
  sha256            TEXT PRIMARY KEY,
  rel_path          TEXT NOT NULL,             -- path under <root>
  bytes             INTEGER NOT NULL,
  width             INTEGER NOT NULL,
  height            INTEGER NOT NULL,
  orientation       TEXT NOT NULL CHECK (orientation IN ('landscape','portrait','square')),
  subject           TEXT,
  title             TEXT,
  description       TEXT,
  alt               TEXT,
  categories        TEXT NOT NULL,             -- JSON array of category slugs
  suggested_slug    TEXT,
  analyzed_at       TEXT NOT NULL,             -- ISO 8601
  analyzer_model    TEXT NOT NULL
);
CREATE INDEX image_categories ON image(categories);
CREATE INDEX image_orientation ON image(orientation);

CREATE TABLE category (
  slug              TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  parent_slug       TEXT
);

CREATE TABLE slot_use (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  image_sha256      TEXT NOT NULL,
  slot_id           TEXT NOT NULL,             -- e.g. 'kitchen-remodeling.hero'
  location          TEXT,                      -- e.g. 'homepage/slider-1'
  used_at           TEXT NOT NULL,
  FOREIGN KEY (image_sha256) REFERENCES image(sha256),
  UNIQUE (image_sha256, slot_id, location)     -- never reuse same image on same slot+location
);
CREATE INDEX slot_use_slot ON slot_use(slot_id, location);
```

### "Used per section, reusable elsewhere" — encoded correctly
- `slot_use` is keyed on `(image_sha256, slot_id, location)`. The same image CAN be picked for `kitchen-remodeling.gallery` and for `flooring.hero` — that is a different `slot_id`, allowed.
- The same image cannot be picked twice for `homepage/slider-1`, which protects against the agent re-running a pick and getting the same hero.
- The agent can ask explicitly: `img pick --allow-reuse` to override when a user truly wants the same image in two places.

### Re-analyze vs reuse
- The sidecar carries the original analysis. If a file's `sha256` is unchanged, we **never** re-call the AI. That makes the second `analyze` of the same folder cheap.
- If a file's `sha256` changes, we treat it as a new image and the old sidecar stays for audit.

### Categories as data, not code
- Ship a `categories.json` with a baseline taxonomy (kitchen-remodeling, bathroom-remodeling, basement-remodeling, interior-painting, exterior-painting, flooring, roofing, decks-and-patios, doors-and-windows, electrical, plumbing, landscaping, other). Users can extend it per project in `.img-ia/config.json`. The prompt is built from this list, not hardcoded.

---

## 6. CLI Command Shape (High-Level)

The tool's binary name is `img` (short, agent-friendly). Subcommand shape is **verb-first, noun-second** because that reads naturally in shell pipelines and in agent-generated commands:

```
img analyze <root> [--recursive] [--concurrency 3] [--model <id>] [--dry-run]
img optimize <root> <files...> [--format jpg|png|webp|avif] [--quality N]
                       [--strip-metadata] [--max-width N] [--max-height N]
img pick    <root> --category <slug> [--categories <slug,slug>]
                 --slot <preset> | --width N --height N [--orientation landscape|portrait|any]
                 [--format jpg|png|webp|avif] [--count 1] [--allow-reuse]
                 [--location <id>]   # e.g. "homepage/slider-1" to record usage
img mark-used <root> --image <path> --slot <id> --location <id>
img list     <root> [--category <slug>] [--orientation <o>] [--unused] [--json]
img stats    <root> [--json]
img config [set|get|list] [key] [value]
img doctor   # checks Node version, sharp loaded, exiftool binary, configured provider ping
```

### Output contract
- **Human mode** (default when stdout is a TTY): pretty, colored, but **never blocks the JSON shape** — humans can read the same fields.
- **JSON mode** (`--json` or when stdout is piped / not a TTY): single JSON object on stdout, all status on stderr. This is the only mode an agent needs.
- **Exit codes**: `0` success, `2` no match for `pick` (the agent can distinguish "no good image" from "tool crashed"), `3` invalid input, `4` provider error, `5` filesystem error.

### A worked `pick` example
```bash
img pick ./client-site \
  --category kitchen-remodeling --orientation landscape \
  --width 1800 --height 980 --format webp \
  --slot hero --location homepage/slider-1
```
On success, stdout:
```json
{
  "ok": true,
  "match": {
    "sourcePath": "kitchen-remodeling/0001-white-cabinets-granite-countertop.jpg",
    "outputPath": "kitchen-remodeling/_out/0001-hero-1800x980.webp",
    "width": 1800, "height": 980,
    "format": "webp", "bytes": 142311,
    "imageId": "sha256:9f…"
  },
  "alternatives": [ "kitchen-remodeling/0007-island-pendant-lights.jpg" ]
}
```
On no match (exit 2):
```json
{
  "ok": false,
  "reason": "no_candidate",
  "details": {
    "category": "kitchen-remodeling",
    "orientation": "landscape",
    "minWidth": 1800, "minHeight": 980,
    "considered": 14, "afterFilters": 0
  }
}
```

---

## 7. Non-Obvious Risks, Edge Cases, and Constraints

1. **EXIF rotation is silent.** Cameras store the image sideways and rely on an EXIF tag to tell the viewer. Naive decoders show it rotated. `sharp.rotate()` reads the tag; if we ever bypass `sharp` we must do the same, or our pick-by-orientation filter will silently select sideways photos.
2. **Upsell temptation.** Agents (and humans) hate failing. The agent may try to recover from a "no good image" result by asking the tool to upscale. The tool MUST refuse. Upscaled images look awful on a hero slider and waste bandwidth. The contract is "fail loudly, never upscale." The proposal should encode this as a non-negotiable requirement.
3. **GPS / PII leakage.** Client dumps often include phones that geotag photos. Stripping metadata is not a "nice to have" — it's the whole point of the `optimize` step. We must also strip **ICC color profiles** that can leak the printer/owner and that some renderers mishandle.
4. **File rename + agent references.** After `analyze`, files are renamed. If the agent cached a path from a previous run, it will be stale. Mitigation: every response that references an image must use the **stable `sha256` id** plus the path, and the agent's instructions must tell it to re-query. The `list` and `pick` commands must return the current `rel_path`.
5. **Duplicate detection.** A client dump of 200 photos often has 30 duplicates. We must dedupe by `sha256` BEFORE calling the AI provider; otherwise we burn tokens and time. Dedup is part of `analyze`, not a separate step.
6. **Heuristic category overlap.** A photo of a marble countertop in a kitchen is "kitchen-remodeling" AND "countertops" (which the user didn't list, but we shipped a default for). Multi-label categories are fine and expected; the pick filter must support `--categories a,b` (match any) vs `--category a` (match only this one).
7. **Concurrent analyze on huge folders.** A 5,000-image folder at 3s/image = 4 hours. We need: (a) concurrency control, (b) per-folder cache (we have it via sha256), (c) a graceful `Ctrl+C` that persists what was done.
8. **Provider rate limits and partial failures.** Long batch runs will hit 429s. We need retry-with-backoff and the ability to resume from the last successful sidecar without redoing the world.
9. **AVIF encode cost.** AVIF is slow. The default `effort: 4` is fine for `optimize`, but for `pick` where the user is iterating, we should default to WebP for speed and let the user opt into AVIF. Document this in the help.
10. **Filename collisions across categories.** If two images both want `kitchen-remodeling-modern-001`, the rename strategy must use the existing file count + a stable hash suffix, never overwrite. The tool should never silently overwrite a file; it errors instead.
11. **Path safety on Windows.** Backslashes, drive letters, MAX_PATH (260 chars), reserved names (`CON`, `PRN`, `NUL`, …). We must always build paths with `path.join`, resolve to absolute, and reject anything that escapes `--root` (a classic `../` injection).
12. **Cross-platform line endings + Unicode in filenames.** A client dump may include filenames with accents, emoji, CJK, and trailing spaces. We sanitize on rename (NFKC normalize, trim, replace spaces with `-`, drop reserved chars).
13. **"Used per section" semantics drift.** The user said: "same image is not reused for the **same section** but may be reused **elsewhere**." That's the (slot + location) key in `slot_use`. We need the proposal to spell out what a "location" is (the agent supplies it — e.g. `homepage/slider-1`).
14. **Sensitive provider config.** API keys must never be logged, never written to the sidecar, never written inside the project. Per-user config goes in `os.homedir()/.config/img-ia/config.json` (or Windows equivalent). Per-project config only stores model/preset choices, not keys.
15. **The "globally installed" promise.** `npm i -g` on Windows puts the binary in `%AppData%\npm`. That works but is not on PATH by default for PowerShell sessions created before npm was installed. The doctor command and the README must call out the PATH setup.

---

## 8. Recommendation: Next SDD Phase

**Ready for proposal.** Move to **`sdd-propose`** to lock the decisions in this exploration into a written proposal with explicit scope, success criteria, rollback, and a stack-justification block that references the comparison in §2.

What the orchestrator should hand the user when moving forward:
- "Stack chosen: Node 22 + TypeScript + sharp + exiftool-vendored + better-sqlite3 + commander.js + vitest. Distribution via `npm i -g` in v1; SEA-based single-binary is a later PR."
- "First AI provider: Ollama Cloud (OpenAI-compatible). OpenRouter and Gemini as configured alternatives."
- "Index: SQLite + per-image JSON sidecar inside the project's `.img-ia/` folder."
- "Three open questions to confirm in the proposal before spec work starts: (1) Does `slot_id` need to be a free string or a configured preset? (2) Should `analyze` move files into category folders by default, or only when `--organize` is passed? (3) Should we ship a default category taxonomy or require the user to declare one per project?"

If the user pushes back on the Node choice, the Go path is the documented fallback (CGO + libvips DLLs shipped alongside the binary) — re-running `sdd-explore` is not needed, the tradeoffs are already in this document.
