---
name: smart-image-cli
description: Use this skill whenever an AI agent needs to use Smart Image CLI (`smart-img`) to analyze, organize, pick, optimize, or track website images. Trigger on requests mentioning `smart-img analyze`, `smart-img pick`, image selection, image optimization, image library indexing, website assets, Ollama setup, provider diagnostics, or using this repo's image tool. This skill is the operational runbook for Claude, OpenCode, Codex, Gemini, and other coding agents using the tool safely.
---

# Smart Image CLI Agent Runbook

Use this skill when you need to operate the `smart-img` CLI from this repository or from an installed package.

The goal is not merely to run commands. The goal is to help an agent safely turn customer image folders into an indexed, reusable website image library without leaking secrets, modifying originals accidentally, or pretending unsupported providers work.

## Safety model

### API keys are human-owned

Agents must not ask the user to paste API keys into chat, logs, issue comments, PR descriptions, or docs.

When configuration is needed, instruct the human to run the CLI setup flow locally and enter the key privately:

```bash
smart-img config setup
```

During setup, the human should:

1. Choose the provider: `ollama`.
2. Choose the model they want to use.
3. Enter their API key in the private prompt.
4. Let the CLI save it in user-scoped config.
5. Run `smart-img doctor` afterward.

If a non-interactive command is absolutely necessary for automation, prefer environment variables and never print the value:

```bash
smart-img --json config --provider ollama --api-key "$OLLAMA_API_KEY" --model minimax-m3 setup
```

Do not echo `$OLLAMA_API_KEY`. Do not write it into project files. Do not commit config containing secrets.

### Provider support policy

For this beta line, only Ollama has been end-to-end validated for real image analysis.

The code may contain presets for other providers, but an agent must not claim OpenRouter, Gemini, or another provider is supported until that provider has passed the same evidence standard:

1. Install/configure test.
2. `smart-img doctor` passes, including provider chat/inference readiness.
3. `smart-img analyze` succeeds on real copied image files.
4. `smart-img list`, `smart-img pick`, `smart-img optimize`, `smart-img mark-used`, and `smart-img stats` behave correctly after analysis.
5. Uninstall/cleanup succeeds.

Listing models is not enough. A provider can list models and still fail inference.

### Protect originals

Customer originals are source material. Do not mutate them during tests unless the user explicitly asked for that exact folder to be organized.

For validation runs, copy a small sample into a sandbox first:

```text
test-root/
  images/
    sample-01.jpg
    sample-02.jpg
```

Then run commands against the sandbox root.

## Choosing the correct root folder

Every command that takes `<root>` operates relative to that root.

Use the most specific folder that contains the images you want the tool to manage.

Good:

```bash
smart-img analyze "./CUSTOMER-IMAGES"
```

Riskier:

```bash
smart-img analyze "."
```

The broader root can include unrelated website files. The CLI ignores common dependency/build folders by default, but the agent should still choose the smallest correct root. Good root selection is not optional housekeeping; it controls what images become part of the library.

By default, `analyze` skips dependency/build/generated folders such as:

- `node_modules`
- `.git`
- `dist`
- `build`
- `coverage`
- `.next`
- `.nuxt`
- `vendor`
- `.img-ia`
- `_out`

## Standard workflow

### 1. Confirm installation

```bash
smart-img --version
smart-img --help
```

If using a local build from the repo:

```bash
npm run build
node dist/cli/program.js --help
```

### 2. Configure provider privately

Tell the human to run:

```bash
smart-img config setup
```

Provider choice: `ollama`.

Model choice: the human may choose the model they want, but the validated beta path has used `minimax-m3`.

Never ask the user to paste the key into the conversation. If the user already pasted a key, do not repeat it, do not save it in memory, and do not write it to files.

### 3. Verify readiness

```bash
smart-img doctor
```

For JSON output:

```bash
smart-img --json doctor
```

A healthy Ollama setup should include:

- `provider-config`: ok
- `provider-endpoint`: ok
- `provider-model`: ok
- `provider-chat`: ok, using `POST /api/chat`

If `provider-chat` fails, `analyze` will not work yet. Fix provider authentication/model/inference access before continuing.

### 4. Analyze images

Run `analyze` against the selected image root:

```bash
smart-img analyze "<image-root>" --fail-fast
```

For a safe preview:

```bash
smart-img analyze "<image-root>" --dry-run --fail-fast
```

What `analyze` does:

- Reads supported image files recursively under `<root>`.
- Sends downscaled image content to the configured vision provider.
- Requires strict JSON analysis output.
- Organizes images into category folders.
- Writes sidecars/index state under `.img-ia`.

Supported categories are loaded from the project taxonomy. If no category fits, the model should use `uncategorized`.

### 5. Inspect the library

```bash
smart-img list "<image-root>"
smart-img stats "<image-root>"
```

Use `list` to find canonical image paths, hashes, categories, dimensions, and usage records.

Use `stats` to confirm totals by category/orientation and detect missing thumbnails or orphaned records.

### Picking a slot-ready image

Use `pick` after images have been analyzed and indexed.

```bash
smart-img pick "<image-root>" --category interiors --orientation portrait --width 300 --height 400 --top-k 3
```

Useful options:

- `--category <id>`: one required category.
- `--categories <ids>`: comma-separated alternatives.
- `--orientation <landscape|portrait|square|panorama>`.
- `--width <px>` / `--height <px>` minimum dimensions.
- `--format <jpg|png|webp|avif>` output format.
- `--slot <name>` and `--location <name>` for usage tracking.
- `--allow-reuse` only when repeat use is acceptable.
- `--source local|pixabay`: image source. `local` is the default; `pixabay` is explicit only — never an automatic cross-source fallback.
- `--safesearch true|false`: Pixabay only (default `true` when `--source pixabay`).
- `--query` is required for `--source pixabay` (composed query ≤ 100 characters).

If `pick` returns `no_candidate`, inspect `smart-img list` (local) or loosen query/orientation/size constraints (Pixabay). Do not invent a result.

Canonical Pixabay reference: `docs/providers/pixabay.md`.

### Pixabay configuration decision gate

`--source pixabay` requires a Pixabay API key. This is a separate private flow — distinct from Ollama/vision setup (`smart-img config setup`).

| Situation                                                            | Action                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| User wants `pick --source pixabay` and no key is configured          | Run the Pixabay setup gate below, then STOP and wait for the human to confirm. |
| `pick --source pixabay` returns `missing_pixabay_credential`         | Read the guidance fields, run the setup gate below, then STOP and wait.        |
| User already configured the key via `smart-img config pixabay setup` | Resume with `smart-img pick --source pixabay --query ...`.                     |
| User pasted an API key in chat                                       | Do not repeat, store, or use it. Redirect them to the private setup command.   |
| User asks for Unsplash / `--source unsplash`                         | Rejected by the CLI (exit 3). Direct them to `--source pixabay` or `local`.    |

Pixabay setup gate (agent runbook):

1. Tell the human: "Pixabay requires an API key. Obtain one at https://pixabay.com/api/docs/."
2. Give the private setup command and STOP — do not run it for the human and do not ask for the key:

   ```bash
   smart-img config pixabay setup
   ```

3. Wait for the human to confirm setup completed.
4. Resume:

   ```bash
   smart-img pick "<image-root>" --source pixabay --query "<intent>" --orientation landscape --width 1600 --height 900 --slot home.hero
   ```

Hard rules for Pixabay:

- Never ask the user to paste the API key into chat, PRs, issues, or docs.
- `smart-img config pixabay setup` is interactive/private only. No secret flag/argv path; non-TTY/JSON mode returns actionable setup guidance without prompting.
- Never echo the key in logs, commands, or JSON (`[REDACTED]`). Never suggest `config set pixabay.apiKey`.
- Key lives only in user-scoped config (`pixabay.apiKey`), never project config.
- `PIXABAY_API_KEY` is an operator-managed runtime override (env > user config). It is NOT a setup input and must not be routed through agent-controlled buffers.
- Pixabay is an image source, not an AI vision provider. Do not conflate `config pixabay setup` with `config setup` (Ollama).
- Search always uses `image_type=photo` and default `safesearch=true`. Responses cache per project for 24 hours (key stripped). HTTP 429 → `rate_limited` with no automatic retry.
- Already-used Pixabay ids for the same slot+location are skipped before download; exactly one image downloads per successful pick.
- Downloads are for combined-work / customer-website use only — no standalone redistribution.
- Do not upscale; a free-tier size limit may still succeed with a structured `resolution_cap` warning.

### 7. Optimize an image

Use canonical paths from `smart-img list`:

```bash
smart-img optimize "<image-root>" "interiors/example-001.jpg" --format webp --max-width 800
```

The output goes under `_out` by default.

Do not upscale. Prefer web-friendly formats such as `webp` unless the user requires another format.

### 8. Record usage

Use `mark-used` when a website slot has consumed an image:

```bash
smart-img mark-used "<image-root>" --path "interiors/example-001.jpg" --slot hero --location homepage
```

or by hash:

```bash
smart-img mark-used "<image-root>" --sha "<sha256>" --slot hero --location homepage
```

Usage tracking helps future agents avoid repeating the same image in the same slot/location.

## Test/validation workflow for agents

When validating the tool, use a temporary sandbox:

```text
<test-site>/.smart-image-cli-usage-test/
  home/       # isolated HOME/APPDATA if needed
  work/
    images/  # copied sample images only
```

Recommended validation sequence:

```bash
smart-img --version
smart-img config setup
smart-img doctor --root "<sandbox>/work"
smart-img analyze "<sandbox>/work" --fail-fast
smart-img list "<sandbox>/work"
smart-img stats "<sandbox>/work"
smart-img optimize "<sandbox>/work" "<canonical-path-from-list>" --format webp --max-width 800
smart-img pick "<sandbox>/work" --category <category-id> --orientation <orientation> --width 300 --height 400 --top-k 3
smart-img mark-used "<sandbox>/work" --path "<canonical-path-from-list>" --slot hero --location homepage
smart-img stats "<sandbox>/work"
```

If testing installation/uninstall, install outside the root being analyzed when possible. If you install inside the analyzed root, dependency directories should be ignored, but a separate install prefix is cleaner.

## Troubleshooting

### `provider-chat` fails

Cause: the provider can list models but cannot run inference/chat.

Action:

1. Ask the human to rerun private setup:
   ```bash
   smart-img config setup
   ```
2. Confirm provider is `ollama`.
3. Confirm the chosen model supports vision/image input.
4. Confirm the API key has inference access.
5. Re-run:
   ```bash
   smart-img doctor
   ```

Do not ask for the API key in chat.

### `analyze` returns invalid analysis JSON

Cause: the model returned prose/Markdown or a schema mismatch.

Action:

- Confirm the current build includes the strict analysis prompt.
- Re-run once; model output can vary.
- If it persists, capture the redacted error and improve the prompt/schema handling. Do not silently accept invalid output.

### `pick` returns `no_candidate`

Cause: no indexed image matches the requested category/orientation/dimensions/reuse constraints.

Action:

1. Run `smart-img list "<root>"`.
2. Check actual categories and dimensions.
3. Loosen constraints intentionally or analyze more images.

### `mark-used` returns `not_found`

Cause: the path/hash is not an indexed live occurrence.

Action:

- Use a path or SHA from `smart-img list`.
- Run `analyze` first if no library exists.

### Unexpected images are analyzed

Cause: root was too broad or ignored directories need expansion.

Action:

- Prefer the smallest image-only root.
- Verify dependency/build directories are ignored.
- Add a focused ignore rule in code only after confirming the directory is generally unsafe/noisy.

## Reporting results back to the user

Keep reports concise and evidence-based:

```text
Install: PASS
Config: PASS, key redacted
Doctor: PASS, provider-chat OK via Ollama /api/chat
Analyze: PASS, processed N images
Pick/Optimize/Usage: PASS
Cleanup: PASS
Notes: <gotchas or follow-ups>
```

Never include API key values. If a secret appears in tool output, redact it before quoting.

## Agent behavior rules

- Prefer commands with `--json` when parsing output programmatically.
- Use `smart-img list` output as the source of truth for canonical paths and hashes.
- Do not fabricate success if a command fails.
- Do not claim provider support without end-to-end evidence.
- Do not modify customer originals during validation unless the user explicitly chose that folder for organization.
- If the user wants a release-quality validation, include install, config, doctor, analyze, list, optimize, pick, mark-used, stats, uninstall, and cleanup.
