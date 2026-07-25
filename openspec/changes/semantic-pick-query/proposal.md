# Proposal: Semantic `img pick` Query Support

## Intent

`img pick` only matches on structured constraints (category, orientation, dimensions).
Agents cannot express intent like "a bright bathroom" and get a reasoned choice.
This change adds a `--query` intent layer over the existing constraint match, ranking
constraint-eligible candidates by metadata and returning a selection reason plus
alternatives — without re-reading or re-analyzing image bytes.

**Goals**: intent-driven ranking; deterministic-by-default (local, zero spend);
explicit, auditable AI mode; loud failure over silent degradation.

## Scope

### In Scope
- `--query <text>`, `--semantic local|ai`, `--top-k <1..10>` flags on `pick`.
- Deterministic local metadata ranker (default; no provider, no spend).
- AI ranker over EXISTING index metadata via the configured provider (text-only).
- Success `ranking` block: `mode`, `reason`, `score`, `alternatives[]`.
- Typed AI failure: `reason: "ai_ranking_failed"`, exit code `4`, no fallback.

### Out of Scope (Non-Goals)
- Re-reading / re-analyzing / vision re-rank of image bytes.
- DB / index schema migration (metadata already in `ImageRecord`).
- Hidden provider spend — AI runs only on explicit `--semantic ai`.
- Local fallback that masks provider failures.
- New runtime dependency; separate text-ranker model override (future).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `image-selection`: add semantic query ranking, selection reason, and `--top-k`-bounded alternatives; constraint-only path unchanged.
- `ai-provider`: add text-only ranking contract (metadata, no image bytes), cost caps, prompt-injection guardrails; reuse existing error taxonomy.

## Approach

Add a `TextRanker` seam behind pick. Constraint match (`matchSlot`) runs unchanged, then
pre-filtered eligible candidates are ranked only when `--query` is present. Local mode is a
pure token-overlap function (stopword removal, stable sha256 tie-break). AI mode POSTs
metadata (`subject, title, description, altText, categories`) to the SAME OpenAI-compatible
endpoint with NO image content, parsed as strict JSON `{sha256, score, reason}[]`, reusing
`VisionProviderError` types and `defaultSecretRedactor`.

## CLI Examples

```
img pick ./assets --category bathroom --query "bright naturally lit shower"
img pick ./assets --category bathroom --query "bright shower" --semantic ai --top-k 5
img pick ./assets --category kitchen            # unchanged: no --query, constraint-only
```
`--query` without `--semantic` defaults to `local` and emits a stderr note.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/commands/pick.ts` | Modified | New flags + validation (`invalid_input`/exit 3). |
| `src/app/pick-service.ts` | Modified | Branch on semantic mode; thread ranking + `topK`. |
| `src/domain/slot-matcher.ts` | Modified | Additive text fields on `SlotCandidate`; `localTextScore`. |
| `src/adapters/vision/provider.ts` | Modified | New `TextRankerProvider` sibling interface. |
| `src/adapters/vision/local-text-ranker.ts` | New | Deterministic default ranker. |
| `src/adapters/vision/text-ranker-openai-compat.ts` | New | Text-only AI adapter. |
| `openspec/specs/image-selection`, `ai-provider` | Modified | Delta specs. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Uncontrolled AI spend | Med | Local default; cap payload (N=25, hard 50); bounded prompt. |
| Prompt injection via metadata | Med | Metadata treated as DATA; strict JSON; length-bounded, redacted `reason`. |
| Non-deterministic local order | Low | Pure fn, no randomness, sha256 tie-break; golden tests. |
| Provider failure masked | Low | Typed error, exit 4, no silent fallback. |
| Configured vision model weak at text ranking | Med | Reuse for v1; document text-ranker override as future work. |

## Rollback Plan

Additive and flag-gated: revert the pick-service branch and remove the three flags.
Without `--query`, behavior is byte-for-byte the current constraint path. New adapter files
are unreferenced once the flags are gone. No schema/data migration to unwind.

## Dependencies

- Configured OpenAI-compatible provider (AI mode only); local mode has none.
- Runtime: existing Node 22 + TypeScript + zod stack (no new deps).

## Success Criteria

- [ ] `--query` ranks constraint-eligible candidates and returns a `reason` + alternatives.
- [ ] `--semantic` defaults to `local`; identical `--query` runs yield identical order.
- [ ] `--semantic ai` uses metadata only — no image bytes on the wire.
- [ ] AI failure returns `ai_ranking_failed` with exit code `4`, never a silent local fallback.
- [ ] `--top-k` (default 3, range 1..10) bounds both success and `no_candidate` alternatives.
- [ ] Constraint-only pick (no `--query`) is unchanged.

## Work-Unit Slicing (Suggested PRs)

- **PR1**: domain text fields + local ranker + unit/golden tests (no CLI change).
- **PR2**: AI text-ranker adapter + `TextRankerProvider` + integration/e2e tests.
- **PR3**: CLI flags, service wiring, manifest `ranking` shape + tests.
- **PR4**: delta specs finalize, doctor diagnostics, docs, archive.
