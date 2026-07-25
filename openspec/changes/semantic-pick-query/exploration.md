# Exploration: Semantic `img pick` Query Support

## Current State

`img pick` is a constraint-based selector over the project-local SQLite index
(`SqliteIndex.query()`), driven by category / orientation / width / height /
slot / location / format flags. All matching, ranking, and alternative
generation go through `matchSlot` in `src/domain/slot-matcher.ts`, which uses
a strict lexicographic tier scheme (`category > orientation > dimension
deficit > reuse`) and emits a top-3 alternatives list on `no_candidate`.

Key facts surfaced from the codebase:

- The CLI parser is `commander` (`src/commands/pick.ts`). Options are
  declared inline; numeric / enum validation is colocated there and
  surfaces `invalid_input` → exit code `3`. There is NO existing
  `--query` / `--semantic` / `--top-k` flag.
- `PickOptions` is a thin extension of `SlotRequest`; the service builds
  candidates with only `sha256, canonicalRelPath, categories, orientation,
dims, used` — `subject`, `title`, `description`, `altText` are not
  threaded through the matcher today.
- `SqliteIndex.query()` already returns the full `ImageRecord`, which carries
  parsed `ImageAnalysis` metadata. v1 semantic ranking uses `subject`,
  `categories`, `title`, `description`, and `altText` only; `suggestedSlug`
  remains available index metadata but is not part of the PR1 local ranking
  contract. No new DB schema is needed to feed metadata to a ranker.
- The `VisionProvider` interface (`src/adapters/vision/provider.ts`) is
  vision-only: `analyze(VisionInput { imageBytes, mimeType, prompt })` and
  returns an `ImageAnalysis`. There is no text-only / metadata-only
  interface today. The OpenAI-compat adapter sends base64 image bytes in
  every call.
- Provider error taxonomy (`RateLimit`, `Timeout`, `Refusal`,
  `MalformedOutput`) is already established and used by `analyze`. Pick
  does not currently call the provider, so any new provider-backed code
  must reuse this error model.
- Output shape is `CliResult` (`src/cli/output.ts`); pick returns
  `errorResult("pick", "no_candidate", message, { alternatives, cause })`
  on failure and `successResult("pick", { manifest: { sha256, source, output,
  width, height, format, usage } })` on success.
- `StorageRootGuard` + `defaultSecretRedactor` are mature, used by all
  services, and re-applied automatically when pick goes through the
  service. Any new ranker output (e.g. AI `reasons`, `confidence`) is
  redaction-safe by default unless raw metadata is leaked.
- No new dependencies: Node 22 stdlib + zod is enough to add a local
  deterministic ranker. A separate npm dep (e.g. `wink-nlp` /
  `natural`) is avoidable for a first pass — `String#toLowerCase` +
  stopword set + per-field token scoring is sufficient and keeps
  deterministic behavior.

## Affected Areas

- `src/commands/pick.ts` — add `--query`, `--semantic local|ai`,
  `--top-k` options; flag validation; parse wiring.
- `src/app/pick-service.ts` — branch on `semantic` mode after constraint
  match; orchestrate local vs AI ranker; thread alternatives, reasons,
  and a `topK` cap into the success manifest and `no_candidate` result;
  inject a `TextRanker` dep.
- `src/domain/slot-matcher.ts` — extend `SlotCandidate` with the text
  fields (`subject, title, description, altText, categories`) and
  add a pure `localTextScore(candidate, query) → number` function
  (separate from the existing lexicographic scoring so the structured
  match path stays untouched when `--query` is absent).
- `src/adapters/vision/provider.ts` — add a new sibling interface
  `TextRankerProvider` that takes a text query + index metadata
  summaries and returns a structured `RankingResult` (no image bytes).
  Reuse `VisionProviderError` subclasses for the same error taxonomy.
- `src/adapters/vision/text-ranker-openai-compat.ts` (new) — adapter
  that POSTs to the SAME OpenAI-compatible endpoint as vision, but
  with NO image content (text-only), reusing redactor + timeout +
  typed errors. Reads provider config from the same `UserConfig` +
  `ProjectConfig` sources.
- `src/adapters/vision/local-text-ranker.ts` (new) — deterministic
  token-overlap ranker; default and always available. No I/O, no
  provider config, no spend.
- `src/app/runtime.ts` — optional helper to build a `TextRankerProvider`
  from the active vision provider config (model + endpoint + apiKey),
  but keep it decoupled from `VisionProvider` (no image bytes).
- `openspec/specs/image-selection/spec.md` — add delta spec for
  semantic `pick` with local + AI behavior, no-fallback, mandatory
  reason + alternatives on AI.
- `openspec/specs/ai-provider/spec.md` — add delta spec for the
  text-only ranking contract, cost-control rules, prompt-injection
  guardrails.
- Tests: `test/commands/pick-semantic-options.test.ts`,
  `test/app/pick-semantic-service.test.ts`,
  `test/domain/slot-matcher-text.test.ts`,
  `test/adapters/text-ranker-openai-compat.test.ts`,
  `test/adapters/local-text-ranker.test.ts`,
  e2e in `test/e2e/cli-flow.test.ts`.

## Approaches

1. **Reuse `VisionProvider` with metadata-only payloads (no images)**

   - Pros: zero new interface; reuses error taxonomy + adapter.
   - Cons: misleading name; the contract "I send an image" is baked in.
     AI providers often reject or charge differently for text-only
     messages. Couples image-rank path to text-rank path.
   - Effort: Low code, high semantic debt.

2. **New sibling `TextRankerProvider` interface, OpenAI-compat adapter
   reuses the same wire format and config source**

   - Pros: honest contract; vision bytes never travel on pick path;
     same typed errors and redaction; same presets table can be
     consumed (the configured vision model is a fine text ranker for
     metadata-only tasks). Clear seam for future local embedding
     rankers.
   - Cons: a second interface to maintain; one extra file.
   - Effort: Low.

3. **Standalone third-party semantic-search lib (e.g. embed + cosine)**

   - Pros: better ranking quality.
   - Cons: new dependency, new model download path, contradicts the
     "no hidden spend" principle (even local embedding download /
     disk), and the project explicitly chose metadata-only ranking
     ("AI ranks only existing index metadata, not image bytes").
   - Effort: High.

**Recommended: Approach 2 + a deterministic local ranker (Approach 2's
local branch) as the default.** The local ranker is a small pure
function in `src/adapters/vision/local-text-ranker.ts` that scores
`(subject, title, categories, description, altText)` against the query via
tokenized overlap with stopword removal and explicit field weights.
It is deterministic (no randomness, no provider), free, and the
default when `--semantic` is omitted or `--semantic local` is
explicit. AI mode is gated behind `--semantic ai` and reuses the
configured OpenAI-compatible endpoint with a JSON request that
emits `{ sha256, score, reason }[]`.

## Recommendation

Adopt Approach 2 with a deterministic local ranker as the default
local mode and an OpenAI-compat text-only adapter for AI mode. The
CLI surface is:

```
img pick <root> [--category ...] [--orientation ...] [--width ...] [--height ...]
              [--slot ...] [--location ...] [--format ...] [--allow-reuse]
              [--query <text>] [--semantic local|ai] [--top-k <1..10>]
```

- `--query` is optional and only meaningful with `--semantic`. If
  passed without `--semantic`, default to `--semantic local` and
  emit a non-fatal warning so the flag combo is explicit.
- `--semantic` defaults to `local`; `ai` is opt-in.
- `--top-k` default is `3`, range `1..10`. Caps the alternatives
  emitted on `no_candidate` and the final ranked list in success
  output.
- AI failure (rate-limit, timeout, refusal, malformed) surfaces as
  a typed `provider_error` with `reason = "ai_ranking_failed"` and
  exit code `4` (existing `PROVIDER_ERROR`). NO silent local
  fallback. The caller can re-run with `--semantic local`.
- Success result includes a `ranking` block on the manifest with
  `{ mode, reason, score, topK, alternatives: [{ sha256, score,
reason }] }`. `mode` is `"local"` or `"ai"`. `reason` is a
  short human-readable explanation (e.g. "matches query tokens
  'bathroom', 'luminoso' against subject/title/description") so
  agents have auditable selection context.
- `no_candidate` result keeps the existing `alternatives` list
  (top 3 by current lexicographic score) and ADDS a `ranking`
  block when `--semantic` is set, with the same shape but
  reason = "no_candidate".

The constraint path (no `--query`) is byte-for-byte unchanged:
`matchSlot` keeps using the lexicographic tier scheme. The text
ranker only runs when `query` is present and pre-filtered to
constraint-eligible candidates (so a wrong-category image is never
promoted into semantic top-k by mistake).

## Risks

- **Cost / spend control** — AI mode costs tokens. Mitigation:
  `TextRankerProvider` MUST cap payload size (top N constraint-
  eligible candidates, default N = 25, hard cap 50), use a
  short, bounded prompt, and surface token spend in a doctor-style
  diagnostic. Default is `local`, so the only way to spend is the
  explicit `--semantic ai`.
- **Prompt injection from metadata** — `subject`, `title`,
  `description`, `altText` are user-derivable. A crafted sidecar
  could try to inject instructions. Mitigation: the AI prompt
  treats metadata as DATA, not instructions; the response is
  parsed as STRICT JSON `{ sha256, score, reason }[]`; the model
  is forbidden from echoing metadata text; the `reason` field
  is length-bounded and run through the same `defaultSecretRedactor`
  so a malicious description cannot exfiltrate through the result.
- **Deterministic local ranking** — local ranker MUST be a pure
  function with no randomness and stable tie-breaks (e.g. sha256
  ASC) so two runs of the same `--query` return the same order.
  Tests assert a golden input set yields a fixed order.
- **Provider failure semantics** — typed `VisionProviderError`
  subclasses (RateLimit/Timeout/Refusal/MalformedOutput) are
  reused. A non-200/429 response becomes
  `MalformedOutputProviderError` so the service emits exit
  code `4` and `reason: "ai_ranking_failed"`. No silent
  fallback to local.
- **Privacy / redaction** — text ranker does not transmit image
  bytes; only `subject + title + description + altText +
categories` per candidate, capped at 25 (configurable,
  hard cap 50). Secret-redactor runs over the AI response
  before emit. Project-config secret scrubber already covers
  metadata being injected via `--query`.
- **Schema compatibility** — extending `SlotCandidate` with
  optional text fields is a non-breaking additive change to
  the domain type. `matchSlot` callers that do not pass the
  new fields keep the existing lexicographic behavior
  unchanged.
- **Provider config reuse** — picking the text ranker model
  from the same `UserConfig.activeProvider` is convenient but
  the same configured vision model may be a poor text ranker
  for a large prompt. Mitigation: first pass reuses the
  configured model; spec records "future: allow text-ranker
  model override in project config" as a non-goal for v1.
- **`--top-k` semantics split** — top-k applies to BOTH the
  success-path ranking (manifest `ranking.alternatives`) AND
  the `no_candidate.alternatives` list. The existing
  `alternativesFor` slice is currently hard-coded to 3;
  this change replaces that hard code with the configurable
  value while preserving the previous default of 3 for the
  non-semantic path.

## Open Questions / Blockers

1. **Where should the text-only provider error live?** It uses
   the same HTTP shape as vision but a different intent. Two
   options: (a) reuse `VisionProviderError` classes verbatim
   (cheaper, slight semantic noise) or (b) add a parallel
   `TextRankerProviderError` hierarchy (cleaner, more code).
   _Recommendation: (a) for v1 to avoid duplicate error
   taxonomy, document the reuse in design.md._
2. **`--top-k` cap ceiling** — confirmed `1..10` is enough for
   v1; doctor reports if a user hits the cap with a useful
   next-step message.
3. **Should the AI prompt include image paths?** No — paths
   are operational metadata, not semantic. Include only
   `subject + title + description + altText + categories`
   per candidate. Confirm with user before implementation.
4. **Should `--query` work without `--semantic` (auto-pick
   local)?** Yes with a one-line stderr note saying
   "defaulted to --semantic local". Confirm the warning is
   acceptable, not just an info log.
5. **Token-cost / rate-limit surfacing** — should we record a
   `usage` event with `source: "semantic_pick_ai"` in the
   usage journal? Probably no (it's a read, not a pick), but
   confirm whether audit logs are desired.

## Ready for Proposal

Yes. The change is well-scoped, additive, and reuses every
existing seam (index query, provider error model, output
envelope, exit codes, redactor, path guard, presets, secret
scrubber). No DB migration, no new runtime dep, no breaking
change to existing pick behavior.

**Proposed change slug**: `semantic-pick-query`
**Default top-k**: `3` (range `1..10`)
**Default semantic mode**: `local` (no provider call, no spend)
**AI mode trigger**: explicit `--semantic ai`
**Failure semantics**: typed `provider_error` + exit code `4`,
no silent fallback
**Work-unit slicing (suggested)**:

- PR1: domain + local ranker + unit tests (no CLI changes).
- PR2: AI text-ranker adapter + integration tests + e2e.
- PR3: CLI surface (`--query`, `--semantic`, `--top-k`),
  service wiring, manifest shape, manifest tests.
- PR4: docs, doctor/diagnostic additions, archive.
