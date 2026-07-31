# Smart Image CLI — Agent Instructions

This repository builds `smart-image-cli`, exposed as the `img` command.

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
  img config setup
  ```

- For this beta line, only `ollama` is end-to-end validated for real image analysis.
- Do not claim OpenRouter, Gemini, or any other provider works until it has install → configure → doctor → analyze evidence.
- Listing models is not enough; `provider-chat` must pass and `img analyze` must work on real copied images.

## Customer image safety

- Treat customer originals as protected source material.
- For tests, copy a small sample into a sandbox first.
- Do not modify `CUSTOMER-IMAGES` unless the user explicitly chose that exact folder for organization.
- Prefer the narrowest correct image root instead of the whole website/project folder.

Example preferred root:

```bash
img analyze "./CUSTOMER-IMAGES"
```

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
img doctor
img analyze "<image-root>" --fail-fast
img list "<image-root>"
img stats "<image-root>"
```

When testing installation/uninstall, use an isolated sandbox and clean it afterward.

## Current known behavior

- Ollama image analysis uses native `POST /api/chat`.
- `doctor` checks provider config, endpoint, model, and chat/inference readiness.
- `analyze` ignores common dependency/build/generated folders such as `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.nuxt`, `vendor`, `.img-ia`, and `_out`.
- `pick` requires an existing analyzed/indexed library; if it returns `no_candidate`, inspect `img list` and adjust constraints instead of inventing a result.

## Commit discipline

- Keep changes as small, reviewable work units.
- Keep tests with the behavior they verify.
- Do not add AI attribution to commits.
- Validate RDD/Gentle AI gates when enabled before committing or delivering.
