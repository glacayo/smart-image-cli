# Design: Smart Image CLI (`img`)

## Technical Approach

Layered TypeScript (strict, ESM) CLI on Node.js 22 LTS via `npm i -g`. Native capability ships as prebuilt npm binaries — `sharp` (libvips), `exiftool-vendored` (bundled ExifTool), `better-sqlite3` — so users never manually install image tooling. Standalone packaging is deferred.

```
src/cli        commander shell, output modes, exit codes
src/commands   thin subcommand files (parse → service → render)
src/app        Analyze/Optimize/Pick/Config/Doctor services (orchestration)
src/domain     PathGuard, SlugNamer, SlotMatcher, ResizePlanner, Taxonomy (pure, zero I/O)
src/adapters   SharpProcessor, ExiftoolMetadata, SqliteIndex, SidecarStore, OpenAICompatVision
.img-ia/       sidecars + usage journal = durable truth; SQLite = rebuildable view
```

Domain stays pure; adapters swappable (Go or `node:sqlite` later without touching `app`/`domain`).

## Architecture Decisions

| Decision | Choice | Alternative (rejected) | Rationale |
|---|---|---|---|
| Path safety | `PathGuard.resolveInside(root,p)`: resolve absolute; reject if `path.relative(root,p)` escapes `--root`. Validates EXISTING input paths VERBATIM (resolve + escape check only — it does NOT sanitize/rewrite the input filename). Sanitization (NFKC, Windows-reserved, spaces→`-`) is applied ONLY to generated filenames/slugs by `SlugNamer`/the output path planner, never to existing input paths before read/hash | Regex blacklists — brittle on Windows | One choke point; spec forbids I/O outside `--root`; input paths stay verbatim, generated names stay safe |
| Symlinks / junctions / reparse | `lstat` first; if symlink/junction/reparse → `realpath` to a canonical real path; reject if real path escapes `--root`; track visited real paths in a `Set` to break loops; never follow a link whose target is outside `--root` | Silent follow or silent skip | Deterministic on Windows + POSIX; prevents loops and escape via links |
| Windows path budget | `PathGuard` enforces a two-stage length budget: (1) **input validation** before I/O rejects `--root`/argument escapes (no sanitization of existing input paths — they are validated/resolved verbatim); (2) **output path-budget check** runs AFTER classification, before any write, on the projected `<root>/<category>/<slug>-<NNN>-<sha7>.<ext>` (slug produced by `SlugNamer`, sanitized). If it would exceed `MAX_PATH - 32` (headroom for temp/rename), shorten the slug to `{slug-truncated}-{sha7}` and re-check; if still over, fail with exit `5` *before* writing — never warn-only | Warning-only on long paths; single-stage pre-I/O check | Pre-I/O failure is deterministic and reviewable; split avoids mis-budgeting paths whose category/slug are only known after classification |
| No upscale | `ResizePlanner` returns `Unsatisfiable` when target > source; sharp always `withoutEnlargement: true` | Allow-upscale flag | Non-negotiable contract enforced in domain |
| Metadata strip | sharp strip-by-default (never `withMetadata()`/`keepIccProfile()`); exiftool verifies and serves `--keep-metadata` | ExifTool-only strip — slower second pass | sharp drops EXIF/XMP/IPTC/ICC unless asked; keep is opt-in per spec |
| Generated-asset exclusion | Recursive discovery and the rebuild source scan MUST exclude `.img-ia/`, `_out/`, and any configured generated output directories. Exclusion is segment-aware and computed via a relative operand: resolve both `candidate` and `ignoredDir` with `path.resolve`, case-normalize (lowercase) on Windows, then compute `rel = path.relative(ignoredDir, candidate)`. Exclude the candidate iff `rel === ""` (candidate IS the ignored dir) OR (`rel !== ".."` AND `!rel.startsWith("..\\")` AND `!rel.startsWith("../")` AND `!path.isAbsolute(rel)`). This excludes `_out/` and `_out/foo.jpg` but NOT `_outdoor/` or `_outdoor/x.jpg` — a sibling sharing a prefix string is never excluded | Prune by extension only; naive string-prefix match (`startsWith`) | Segment-aware `path.relative` exclusion is deterministic, survives re-runs, and does not over-match sibling directories like `_outdoor/` |
| Content vs occurrence | Content analysis is keyed by `sha256` (one AI call per unique bytes via `DedupeGate`); file *occurrences* are tracked separately on each sidecar as `occurrences: string[]` of rel paths so duplicates share a sidecar and a classification but keep their own on-disk path records. `occurrences[]` is the single term used everywhere (no `aliasPaths`). On a sha cache hit, side-effects fire only "if needed" (move only if not already canonical, merge occurrence only if absent, index upsert only if changed, thumbnail only if missing) — raw duplicate files are still moved/merged when needed | Per-file AI calls; unconditional rewrites on cache hit | Separates "what the image is" from "where copies live"; cheap dedupe under concurrency; one name; idempotent re-analysis with minimal write amplification |
| Duplicate names | `SlugNamer`: `{slug}-{NNN}`; collision appends `-{sha256:0..7}`; exclusive-create (`wx`) | Overwrite / timestamps | Never silent overwrite; sha suffix deterministic |
| Fail with alternatives | `SlotMatcher` scores near-misses (category > orientation > dimension deficit); top 3 + reasons; exit 2 | Degraded best-effort match | Agents must distinguish no-match from crash |
| Usage durability | Append-only `usage.jsonl` (durable) + `slot_use` table (derived, rebuilt from journal) | SQLite-only — lost on rebuild | Keeps DB rebuildable-view invariant for usage |
| better-sqlite3 risk | `engines.node >=22`; `ImageIndex` interface; `doctor` verifies native load; documented `node:sqlite` fallback | Adopt `node:sqlite` now — still maturing | Prebuilds cover Win x64; `doctor` catches gyp-fallback install failures |

## Data Flow

**analyze**
```
walk(root)
  → skip generated dirs: .img-ia/, _out/, and any configured generated output dir
    (segment-aware exclusion: resolve+lowercase both sides on Windows, then
     rel = path.relative(ignoredDir, candidate); exclude iff rel === "" OR
     (not absolute AND does not start with ".."); _out/ excludes _out/ and
     descendants, NOT sibling _outdoor/)
  → lstat; if symlink/junction/reparse → realpath; reject escape outside --root;
    track visited real paths in Set (loop break)
  → PathGuard input validation: validate the EXISTING input path verbatim
    (resolve, reject escape); do NOT rewrite/sanitize the existing filename
    before read/hash — sanitization applies ONLY to generated slugs/filenames
  → sha256 (content identity)
  → DedupeGate: Map<sha256, Promise<Analysis>> — if sha in-flight or resolved, await it
        (one AI call per unique bytes even under concurrency)
  → sidecar exists for sha?
      yes → sha-cache HIT: treat as classified-without-AI; still run organize-by-default
            but perform each side-effect ONLY "if needed" (idempotent, minimal writes):
            - move ONLY if the source is not already at the canonical path;
            - SidecarStore.mergeOccurrence(sha, rel) ONLY if the occurrence is not
              already present in occurrences[] (the merge itself is idempotent and
              serialized per sha256 so concurrent occurrences of the same bytes
              never get lost; a no-op merge writes nothing);
            - index.upsert ONLY if the occurrence row or content metadata changed;
            - regenerate thumbnail ONLY if missing.
            "if needed" still covers organizing/moving RAW DUPLICATE files: when a
            duplicate source file is not at the canonical path it is moved and its
            occurrence is merged, even though the AI call is skipped. No AI call,
            no classification change.
      no  → downscale(1024) → Vision.analyze → zod-validate → Taxonomy → SlugNamer
  → classify action, then run post-classification output path-budget check:
      projected <category>/<slug>-<NNN>-<sha7>.<ext>; if over budget → shorten slug,
      re-check; if still over → skip file as PathBudgetError (exit 5) BEFORE any write
  → if --dry-run: append planned action to plan[]; DO NOT move/write/sidecar/index/thumbnail
   → else: staged writes with recovery journal (see Staged Writes & Recovery),
     in ONE authoritative order per operation:
       a) Journal BEGIN: records {opId, sha256, sourceRelPath, plannedCanonicalRelPath, action}
       b) Write/commit sidecar content + planned occurrence metadata FIRST
          (temp + fsync + atomic rename) — sidecar is durable before any move
       c) Finalize the occurrence/move atomically to the canonical path
          (temp + fsync + rename) AFTER the sidecar exists
       d) Update the rebuildable SQLite index AFTER the occurrence is live
          (index is derived; if this step fails, recovery/rebuild restores it
           from sidecar + source scan — it is never the gate for durability)
       e) Journal END only after the operation is fully recoverable
     thumbnail: write via temp+rename for cache safety but NOT journaled in the
     durable recovery journal (see Thumbnail Cache Invariant)
    (concurrency-capped; Ctrl+C safe; partial-batch failures are per-file, see Errors)
```

**analyze --dry-run**
```
same walk + lstat/realpath + sha256 + DedupeGate + (cache-hit lookup, no AI if cached)
  → for each candidate: resolve planned {action: "rename"|"move"|"index", from, to, sha256, category}
  → write nothing: no moves, no sidecars, no thumbnails, no SQLite writes, no usage journal writes
  → emit plan[] (TTY table / JSON {ok:true, planned: [...]}) and exit 0
```

**pick**
```
index.query(categories, orientation, ≥w×h, NOT used(slot,location) unless --allow-reuse)
  match → ResizePlanner.plan(source, target)
    → if target exceeds source → {ok:false, reason:"no_candidate",
        cause:"target_exceeds_source", source, requested, alternatives}, exit 2
        (ResizePlanner decides eligibility; never rely on sharp silent cap;
         `pick` wraps the underlying cause under a stable `reason:"no_candidate"` and
         a `cause` field; `optimize` surfaces the same condition directly as
         `reason:"target_exceeds_source"` — consistent per-command shape)
    → else ResizePlanner.produce → staged write _out/ (see Staged Writes & Recovery)
    → UsageTracker.record DURABLY FIRST (append usage.jsonl + fsync) on success of produce
        → if usage write fails → rollback produced _out/ asset,
          emit {ok:false, reason:"usage_failed"}, exit 5
          (usage write failure is a filesystem/write failure, mapped to exit 5,
           NOT provider exit 4)
        → only after usage is durable → emit success manifest, exit 0
        (pick success is transactional: usage must be recorded before manifest, or output rolled back)
  none  → nearMisses(3) → {ok:false, reason:"no_candidate", alternatives}, exit 2
  --allow-reuse → bypass the same (slot,location) exclusion in the query filter;
     the image stays eligible even if already used for that exact slot+location
```

**mark-used**
```
input: --sha <sha256> OR --path <relPath>, --slot <freeText>, --location <freeText>
  → resolve target: by sha (preferred, content-level marking) or by path.
    `--path <relPath>` MUST point to a live, existing occurrence:
      - if the path does not exist on disk → {ok:false, reason:"not_found"}, exit 3
        (sidecar-known but missing on disk is `not_found`, NOT a silent audit-only skip)
      - to mark content by sha regardless of whether a specific occurrence is live,
        use `--sha` instead
  → validate: resolved sha/sidecar exists; slot & location non-empty
   → UsageTracker.record({sha, slot, location, source: "mark-used"})
       conflict-safe upsert: keyed by (sha, slot, location). Repeated `mark-used` calls
       with the same (sha, slot, location) are IDEMPOTENT — the slot_use row is upserted
       in place. Journal-append behavior is FIXED and unambiguous: `usage.jsonl` is an
       append-only log and `mark-used` ALWAYS appends a new line on every successful
       call (never "append only if metadata differs"). Replay dedupes by (sha, slot,
       location) so duplicate lines collapse to one slot_use row; a repeated `mark-used`
       therefore changes no observable state, but the durable journal always reflects
       that the call happened. `--allow-reuse` is NOT a `mark-used` flag; reuse override
       is a `pick` concept only.
   → durable append to usage.jsonl: atomic append + fsync BEFORE `{ok:true}` is emitted
     (staged write — see Staged Writes & Recovery; torn/partial lines are ignored or
     quarantined during replay with a warning/audit entry, never crashing rebuild;
     duplicate lines are deduped on replay, not at append time)
   → append usage.jsonl + upsert slot_use; emit {ok:true, recorded:{...}}; exit 0
  → on unknown sha/path → {ok:false, reason:"not_found"}, exit 3
      reason is stable and agent-readable; not_found maps to exit 3 (invalid input),
      NOT exit 2 (no-match is reserved for pick)
```

**optimize/resize**
```
PathGuard input validation → ImageProcessor.probe (dims, EXIF orientation)
  → ResizePlanner.plan(source, {width?, height?, maxWidth?, maxHeight?, format, quality})
    → if target exceeds source in any requested dimension → explicit failure:
        {ok:false, reason:"target_exceeds_source", source, requested}, exit 3
        (ResizePlanner decides; NEVER rely on sharp's silent withoutEnlargement cap)
    → else plan = {resize|crop params, encode params}
  → ImageProcessor.produce(plan, {keepMetadata})
    → sharp: rotate(EXIF orientation) → resize/crop → encode
    → if --keep-metadata: preserve requested metadata tags (exiftool re-applies them
        AFTER produce so sharp's strip does not lose them); EXIF orientation is ALWAYS
        normalized safely (pixels rotated upright, orientation tag dropped from output)
    → else: fully stripped output
  → staged write _out/ (see Staged Writes & Recovery) → commit → exit 0
```

**list**
```
img list <root> [--category <c>] [--orientation <o>] [--min-width <px>] [--min-height <px>]
  → index.query(filter) over live occurrences only
  → JSON (non-TTY/--json): {ok:true, status:"success", images:[{sha256, canonicalRelPath,
      categories, orientation, dims:{w,h}, occurrences:[...], used:[{slot,location}]}]}
  → TTY: table grouped by category
  → empty result is success: {ok:true, status:"success", images:[]}, exit 0
  → invalid filter (unknown category, non-integer px) → exit 3
```

**stats**
```
img stats <root>
  → aggregate over sidecars + usage.jsonl + index (derived):
      totals: {images, occurrences, sidecars, thumbnails, usageRecords}
      byCategory: [{category, count}]
      byOrientation: [{orientation, count}]
      orphans: sidecars whose occurrences[] are all missing on disk (audit-only)
      missingThumbnails: count of sidecars with no thumbnail (derived cache invariant)
  → JSON: {ok:true, status:"success", totals, byCategory, byOrientation, orphans,
      missingThumbnails}
  → TTY: summary block
  → exit 0 on success; exit 5 if root/index unreadable
```

## File Changes (all Create; greenfield)

| Path | Description |
|---|---|
| `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts` | Setup; `bin: {img}`; `engines.node >=22` |
| `src/cli/{program,output,exit-codes}.ts` | commander wiring, TTY/JSON renderer, codes |
| `src/commands/{analyze,optimize,pick,mark-used,list,stats,config,doctor}.ts` | Thin handlers |
| `src/app/{analyze,optimize,pick,config,doctor}-service.ts` | Pipelines |
| `src/domain/{path-guard,slug-namer,slot-matcher,resize-planner,taxonomy,analysis-schema}.ts` | Pure policies + zod schema |
| `src/adapters/{sharp-processor,exiftool-metadata,sqlite-index,sidecar-store}.ts` | I/O adapters |
| `src/adapters/vision/{provider,openai-compat,presets}.ts` | `VisionProvider` + presets (ollama/openrouter/gemini) |
| `src/config/{user-config,project-config}.ts` | Per-user keys (OS config dir); project overrides (no keys) |
| `assets/categories.json`, `test/**` | Shipped taxonomy; unit/integration/e2e + fixtures |

## Interfaces / Contracts

```ts
interface VisionProvider { id: string; analyze(i: VisionInput): Promise<Analysis>; }
  // VisionInput={imageBytes,mimeType,prompt}; typed errors: RateLimit|Timeout|Refusal|MalformedOutput
interface ImageProcessor {
  probe(p): Promise<ImageInfo>;                       // dims + EXIF orientation
  produce(p, plan: ResizePlan, opts?: {keepMetadata?: boolean}): Promise<OutputAsset>;
    // plan never enlarges (ResizePlanner enforces); keepMetadata re-applies requested tags
    // AFTER sharp's strip; EXIF orientation is ALWAYS normalized safely
  downscaleForVision(p, maxEdge): Promise<Buffer>;
}
interface MetadataReader { read(p): Promise<TagMap>; }
interface MetadataWriter { stripAll(p): Promise<void>; reapplyTags(p, tags: TagMap): Promise<void>; }
interface ResizePlanner {
  // pure: decides eligibility and emits an explicit plan; NEVER delegates the no-upscale
  // decision to sharp's silent withoutEnlargement cap
  plan(source: ImageInfo, target: ResizeTarget): ResizePlan | {ok:false, reason:"target_exceeds_source"};
}
type ResizePlan = { op:"resize"|"crop", w?:number, h?:number, format, quality, keepMetadata?:boolean };
interface ImageIndex {
  upsertContent(r: ImageRecord);            // keyed by sha256: classification, dims, model
  upsertOccurrence(sha, relPath);           // a file copy pointing at content sha
  findBySha(sha): ImageRecord | null;
  query(f: PickFilter): ImageRecord[];      // PickFilter.allowReuse bypasses used(slot,loc) exclusion
    // query returns only LIVE occurrences (path exists on disk); orphan audit data is separate
  rebuildFrom(sidecars: Iterable<Sidecar>, journal: UsageJournal);
}
interface SidecarStore {
  write(sha, sidecar: Sidecar): Promise<void>;          // temp+fsync+rename (durable)
  read(sha): Promise<Sidecar | null>;
  // Atomic per-sha256 occurrence merge: serializes concurrent merges for the SAME sha
  // behind a per-sha lock/transaction so no occurrence is lost under concurrency.
  // DedupeGate dedupes AI CALLS (one analysis per unique bytes); occurrence merges
  // still serialize per sha because multiple file paths can map to the same sidecar
  // concurrently even when the AI call was shared.
  mergeOccurrence(sha, relPath): Promise<Sidecar>;
    // - acquires per-sha mutex/transaction
    // - reads current sidecar (or creates empty shell)
    // - appends relPath to occurrences[] iff not already present (idempotent)
    // - updates canonicalRelPath/primaryFlag if this is the first live occurrence
    // - durable write (temp+fsync+rename) under the lock
    // - returns the updated sidecar
}
interface UsageTracker {
  record(u: Usage): void;                   // always appends usage.jsonl (append-only log) + upserts slot_use; replay dedupes
  isUsed(sha, slot, loc): boolean;
  rebuildFromJournal(journal: UsageJournal): void;   // restore slot_use from usage.jsonl
}
interface SecretRedactor {
  // centralized masking applied to provider errors, stderr diagnostics, doctor, config get/list
  mask(s: string): string;                  // never prints full API keys
  maskValue(v: unknown): unknown;           // redacts config values that look like keys/tokens
}
```

One JSON object on stdout when `--json` or non-TTY (`{ok, status, ...data}` / `{ok:false, status:"failed", reason, details}`); diagnostics on stderr. Exit codes: `0` success, `2` no-match (pick only), `3` invalid input (incl. `mark-used` not_found and `optimize` target-exceeds-source), `4` provider, `5` filesystem/path-safety.

## Staged Writes & Recovery

Moves, sidecars, and index writes are NOT single-step. Every mutating operation that touches durable state is staged so it can recover after interruption (Ctrl+C, crash, disk error). Thumbnails are derived cache, NOT durable state, and are excluded from this journal (see Thumbnail Cache Invariant); they may still be written via temp+rename for cache safety but are never committed/rolled-back through the durable journal.

```
op journal: <root>/.img-ia/.journal/<opId>.jsonl
  1. BEGIN {opId, action:"analyze"|"pick"|"optimize", sha256, sourceRelPath,
            plannedCanonicalRelPath, files:[...]}
  2. STAGE {step:"sidecar"|"move"|"index"|"output", path, tempPath}
       → write to tempPath (exclusive-create), fsync temp
  3. COMMIT {step, path} → atomic rename tempPath→path; fsync target dir
  4. END {opId, status:"committed"|"rolled_back"}
```

- On next launch, `.img-ia/.journal/` is reconciled: any `BEGIN` without `END` is replayed.
  - Committed steps are kept (their temp already renamed).
  - Staged-but-not-committed steps are rolled back (delete temp) and logged.
- Authoritative per-operation order for `analyze` (MUST be followed in this exact
  sequence; this is the same order referenced in the analyze Data Flow):
  1. `BEGIN` — journal the planned operation with `sha256`, source rel path, and
     planned canonical rel path.
  2. sidecar — write/commit sidecar content + planned occurrence metadata FIRST
     (temp + fsync + atomic rename).
  3. move — finalize the occurrence/move to the canonical path LAST among durable
     writes, and only after the sidecar exists.
  4. index — upsert the rebuildable SQLite row AFTER the occurrence is live. The
     index is a derived view; if this step fails, `rebuild` restores it from
     sidecar + source scan. It is never the durability gate.
  5. `END` — journal only after the operation is fully recoverable.
- Recoverable-state invariant (replaces any "MUST NEVER leave" phrasing):
  - A sidecar WITHOUT a live occurrence may exist ONLY as an incomplete operation;
    on recovery it MUST be completed (occurrence re-derived from source scan) or
    reconciled. It is never a silently-acceptable final state.
  - An occurrence WITHOUT a committed sidecar MUST be rolled back / quarantined on
    recovery (move undone, file quarantined for audit) — it is never kept as live.
- Thumbnails are derived cache (see Thumbnail Cache Invariant) and are regenerated,
  never journaled as durable truth; a thumbnail may use temp+rename for cache safety
  outside the durable journal, but its absence/presence is never part of recovery replay.
- `_out/` produced assets in `pick`/`optimize` follow the same staged write; on rollback the
  partial output file is deleted so a failed run leaves no half-written asset.

## `.img-ia/` Storage Layout

```
<root>/.img-ia/
├── config.json               overrides: model/presets/extra categories — never keys
├── sidecars/<sha256>.json    durable truth: classification, dims, original name, model,
│                             canonicalRelPath, occurrences[] (rel paths), primaryFlag
├── usage.jsonl               durable append-only usage journal
├── thumbnails/<sha256>.webp  320px previews (derived cache; regenerable)
├── .journal/<opId>.jsonl     operation/recovery journal (see Staged Writes & Recovery)
└── index.sqlite              derived: image, category, slot_use — rebuilt from sidecars+journal
```

Sidecar fields (durable, rebuild-carrying): `{ sha256, classification, dims, originalName, model, canonicalRelPath, occurrences: string[], primaryFlag }`.
- `canonicalRelPath` — the primary organized path (e.g. `kitchen-remodeling/kitchen-001-1a2b3c4d.jpg`).
- `occurrences[]` — every rel path that shares this `sha256` (organized copy + any retained originals/aliases).
- `canonicalRelPath` IS included in `occurrences[]`; it is the same string and is additionally flagged via `primaryFlag` (or, equivalently, `occurrences[0]` is canonical by convention). Rebuild marks the on-disk path that matches the pre-existing `canonicalRelPath` as primary; if it is missing, the first live occurrence becomes primary and `canonicalRelPath` is updated.
- During rebuild, only LIVE existing occurrences are queryable/selectable; orphaned paths (missing on disk) are retained in the sidecar for audit but excluded from `index.query` results.

## Thumbnail Cache Invariant

Thumbnails (`thumbnails/<sha256>.webp`, 320px) are derived cache, NOT durable truth:
- Missing thumbnail is never an error and never blocks a query; `pick`/`list`/`stats` run without it.
- A thumbnail is regenerated lazily on the next `analyze` or when a `--refresh-thumbnails` flag is passed.
- A sidecar whose thumbnail file is missing on rebuild is counted in `stats.missingThumbnails` and left alone; the index row stays live and selectable.
- Thumbnails are never journaled as durable; they are excluded from the recovery replay and are simply rewritten when absent.

## Index Rebuild

`rebuild` is deterministic and lossless from durable artifacts:

```
rebuild(root):
  1. sidecars: for each <sha>.json → ImageIndex.upsertContent(record);
      for each path in occurrences[] that EXISTS on disk → verify live sha:
        compute sha256 of the live file; ONLY upsert as a live/selectable occurrence
        if the live sha MATCHES the sidecar sha.
        - if live sha differs → mark the path STALE/ORPHAN (audit-only, not selectable)
          and queue the file for re-analyze (new sha → new record on next analyze);
          the mismatched path is retained in the sidecar occurrences[] for audit but
          excluded from index.query results.
      (missing occurrences — path not on disk — are NOT upserted as live rows;
       they stay in the sidecar for audit)
   2. source scan: walk(root) for images NOT in any sidecar's occurrences[],
       EXCLUDING generated dirs (.img-ia/, _out/, and configured output dirs;
       segment-aware exclusion: rel = path.relative(ignoredDir, candidate) after
       resolve + Windows lowercasing; exclude iff rel === "" OR (not absolute AND
       does not start with ".."); _out/ excludes _out/ and descendants, NOT _outdoor/)
      → if sha matches an existing sidecar → add relPath as occurrence (live)
      → if sha is new → mark missing (flag for re-analyze; do NOT invent classification)
    3. usage: UsageTracker.rebuildFromJournal(usage.jsonl) → slot_use table
       (conflict-safe: duplicate (sha, slot, location) lines are deduped on replay —
        always-append means repeats are common and harmless; torn/partial lines are
        ignored or quarantined with a warning/audit entry)
   4. reconcile deleted/edited:
      - sidecar whose occurrences[] paths no longer exist on disk → orphan (retained for audit,
        NOT selectable via index.query; surfaced only in stats.orphans and a dedicated audit view)
      - file whose sha no longer matches the sidecar at that path → treated as new on next analyze
        (also surfaced as stale/orphan audit during step 1)
   5. primary occurrence: among the LIVE, sha-verified occurrences, mark the one matching
      the stored canonicalRelPath as primary; if that path is missing or stale, promote the
      first live, sha-verified occurrence and update canonicalRelPath
```

Rebuild consumes sidecars + `usage.jsonl`; it never calls the AI provider. Deleted files become orphan sidecars (retained for audit, excluded from selectable query results); edited files are reconciled as new records on the next `analyze`.

## Errors and Partial Batch Behavior

Per-file typed errors (emitted individually, batch continues unless noted):

| Error type | Meaning | Exit mapping |
|---|---|---|
| `DecodeError` | Image bytes unreadable/corrupt by sharp/exiftool (decode/parse failure) | exit 5 — skip file, continue batch |
| `ReadError` | Filesystem read failure (permissions, missing, I/O error) | exit 5 — skip file, continue batch |
| `PathEscapeError` | Resolved path outside `--root` (incl. symlink target) | exit 5 — skip file, continue batch |
| `PathBudgetError` | Projected output path exceeds Windows MAX_PATH budget (post-classification) | exit 5 — skip file, continue batch |
| `ProviderError` | `RateLimit\|Timeout\|Refusal\|MalformedOutput` from vision | exit 4 — skip file, continue batch |
| `WriteError` | Move/sidecar/thumbnail/output write failed (path budget, disk) | exit 5 — skip file, continue batch |

Single precedence table (the most severe applicable non-zero code wins; `5 > 4 > 3`):

| Class | Exit | Triggered by |
|---|---|---|
| Invalid request | 3 | Malformed CLI args / schema-invalid invocation / whole-batch invalid input. An empty or no-supported-files batch maps to exit 3 ONLY when treated as an invalid request (e.g. bad flags, unsupported-only args); otherwise an empty-but-valid batch is success/exit 0. |
| Provider failure | 4 | Any `ProviderError` (`RateLimit\|Timeout\|Refusal\|MalformedOutput`). |
| Filesystem / path / read / write / decode failure | 5 | Any `ReadError`, `DecodeError`, `PathEscapeError`, `PathBudgetError`, `WriteError` (corrupt images and read failures use exit 5). |
| No candidate | 2 | Reserved for `pick` no-match. |

Batch status (kept `ok` boolean for backwards compat, added `status` for explicit semantics):

| `status` | Condition |
|---|---|
| `"success"` | all files processed, no skips |
| `"partial"` | some files processed, some skipped (decode/read/write/provider/path errors); batch completed |
| `"failed"` | all files skipped, OR whole-batch invalid input (exit 3). Distinct sub-cases: corrupt/decode-only batch (`failed`, all `DecodeError`) vs all-failed batch (`failed`, mixed error classes) |

When the ENTIRE batch is skipped because every file is unreadable/corrupt (all `DecodeError` or all `ReadError`, with no `ProviderError`/`WriteError`), the batch has no successfully processed output to offer. This is a stable, defined outcome (NOT undefined): status is `"failed"`, `ok:false`, and the exit code is `5` (filesystem/read/decode failure — corrupt image batches and read failures use exit 5), because the failure is that the inputs could not be read — not a provider failure (`4`) and not a no-match (`2`). An empty/no-supported-files batch is NOT exit 5 by default: it is exit 3 ONLY when treated as an invalid request (bad flags / schema-invalid invocation); a valid-but-empty scan is success/exit 0. If the all-skipped batch is purely `PathEscapeError`/`PathBudgetError` it is exit 5. If the all-skipped batch is purely `ProviderError` it is exit 4. If mixed classes, the most severe applicable non-zero code wins (5 > 4 > 3).

Batch behavior:
- A failed file is appended to `skipped[]` with `{path, sha256?, error:{type,message}}` and the batch continues to the next file (no whole-batch abort).
- `skipped[]` error messages are passed through `SecretRedactor.mask` before emission; provider error bodies, stderr diagnostics, `doctor`, and `config get/list` output are all masked via the same central redactor. Full API keys/tokens are never printed.
- At end of batch, emit summary: `{ok: true|false, status: "success"|"partial"|"failed", processed, skipped:[...], failed:[...]}`.
  - `ok` is `true` iff `status === "success"`; `false` otherwise.
- Exit codes (consistent with cli-runtime spec and the precedence table above): `0` success; `5` if any filesystem/path/read/write/decode skip (incl. `PathBudgetError`, corrupt-image batches, read failures); `4` if any provider skip; `3` if invalid input (whole batch / malformed CLI args / schema-invalid), or all files skipped with input-class errors, or an empty/no-supported-files batch treated as invalid request; `2` reserved for `pick` no-match. When multiple error classes occur, the most severe applicable non-zero code wins (5 > 4 > 3).
- `--fail-fast` (opt-in) aborts the batch on the first error and exits immediately with that file's code.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | domain policies; services via `FakeVisionProvider` + in-memory index; exit mapping | vitest; most coverage |
| Integration | adapters on fixture images in temp dirs; strip verified by exiftool read-back | vitest, real binaries, Windows CI |
| E2E | built CLI spawned on fixture project: analyze→pick→no-match; JSON shape, exit codes | vitest + execa |

Tooling: `vitest`, `typescript-eslint` flat config, `prettier`, `tsc --noEmit`. Update `openspec/config.yaml` testing block once the runner lands.

## Migration / Rollout

No migration — greenfield. v1 needs only Node.js 22 + npm; `doctor` checks Node version, sharp load, exiftool spawn, sqlite open, provider ping, PATH hint.

## Open Questions

- [x] Produced-asset directory: default `_out/` per category root; configurable via project config `outputDirs[]`, all of which are excluded from discovery/rebuild (resolved in design).
- [ ] `node:sqlite` fallback adapter timing — v1.x, or only if install failures appear.
