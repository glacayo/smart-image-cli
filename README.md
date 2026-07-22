![Smart Image CLI banner](./smart-image-cli.png)

# Smart Image CLI

Agent-friendly CLI for analyzing, organizing, optimizing, resizing, and selecting website image assets from local project folders.

Smart Image CLI is designed for developers and AI coding agents that need to work with client-provided images without wasting time manually renaming, classifying, compressing, or resizing every file.

## Current status

| Area | Status |
| --- | --- |
| SDD artifacts | Ready |
| Phase 1 foundation | Implemented |
| CLI shell | Implemented |
| Domain policies | Implemented |
| Storage/adapters | Pending |
| App services | Pending |

## What it will do

- Analyze image folders recursively with AI.
- Rename and organize images by detected category.
- Store local metadata and indexes inside the project image root.
- Optimize images for web delivery.
- Resize and crop images for website slots.
- Select the best available image for a requested section.
- Track where images were used so agents avoid repeating assets in the same slot.

## Planned stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js 22+ |
| Language | TypeScript / ESM |
| CLI | Commander |
| Image processing | Sharp |
| Metadata | exiftool-vendored |
| Local index | SQLite + JSON sidecars |
| Testing | Vitest |

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

## Roadmap

1. Foundation and CLI shell.
2. Local sidecar and SQLite storage.
3. Image processing and metadata adapters.
4. AI provider abstraction.
5. Analyze, optimize, pick, mark-used, list, stats, config, and doctor commands.
