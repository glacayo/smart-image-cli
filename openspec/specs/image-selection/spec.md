# Image Selection Specification

## Purpose

Pick the right image for a website slot by category, orientation, and dimensions; record usage against free-text slots; and fail loudly with alternatives rather than degrade or upscale.

## Requirements

### Requirement: Constraint-Based Matching

The system MUST select candidates by category, orientation, and minimum dimensions, supporting single-category (`--category`) and any-of (`--categories a,b`) matching.

#### Scenario: Match on all constraints

- GIVEN an indexed library
- WHEN the agent runs `pick <root> --category kitchen-remodeling --orientation landscape --width 1800 --height 980`
- THEN only images meeting all three constraints are eligible
- AND the best-matching candidate is emitted as a produced asset with a JSON manifest

### Requirement: Fail With Close Alternatives

When no candidate satisfies the constraints, the system MUST fail with a non-zero result and MUST return the closest near-miss alternatives instead of degrading the request.

#### Scenario: No qualifying image

- GIVEN no indexed image meets the requested size
- WHEN `pick` runs
- THEN the tool exits with the no-match code and a structured reason
- AND it returns a list of the closest alternative images considered

### Requirement: No Upscaling or Guessing in Pick

The system MUST NOT upscale a candidate to reach requested dimensions and MUST NOT fabricate a match from an unfit image, regardless of source (local index or Pixabay). For Pixabay, "no upscaling" permits delivering the best available rendition below a requested size only when explicitly reported as a resolution-cap warning (see `image-source-pixabay`); it MUST NOT silently substitute an upscaled image.
(Previously: scoped to local-index candidates only, with no source-specific carve-out.)

#### Scenario: Undersized candidate rejected

- GIVEN the only category match is smaller than the requested width and height
- WHEN `pick` runs
- THEN that image is NOT upscaled and NOT returned as a match
- AND the request is treated as a no-match with alternatives

#### Scenario: Pixabay resolution cap is a reported warning, not a fabricated match

- GIVEN `--source pixabay` and a requested size the account's access tier cannot deliver
- WHEN the pick succeeds with a capped rendition
- THEN the delivered image is never upscaled
- AND the cap is surfaced as a structured warning, not silently hidden

### Requirement: Free-Text Slot Usage Recording

The system MUST record a successful pick against a free-text slot string (e.g. `home.hero.slider`) supplied by the caller.

#### Scenario: Usage recorded on pick

- GIVEN a successful `pick` with `--slot home.hero.slider --location homepage/slider-1`
- WHEN the asset is produced
- THEN a usage record links the image `sha256` to that slot and location

### Requirement: Reuse Semantics

The system MUST keep an image eligible for a different slot after use, MUST NOT auto-suggest the same image for the same slot+location again, and MUST allow override via `--allow-reuse`.

#### Scenario: Reused elsewhere, not in same slot

- GIVEN an image already used for `home.hero.slider` at `homepage/slider-1`
- WHEN the agent picks for a different slot
- THEN the image remains eligible
- AND re-picking the same slot+location excludes it unless `--allow-reuse` is passed

### Requirement: Semantic Query Ranking

The system MUST accept an optional free-text `--query` and, when present, MUST rank the constraint-eligible candidates by that intent, returning the top selection with a human-readable `reason` and a bounded list of `alternatives`. Ranking MUST run ONLY over candidates that already satisfy the structured constraints, so `--query` MUST NOT promote a constraint-ineligible image. When `--query` is absent, selection MUST be identical to the constraint-only path.

#### Scenario: Query ranks eligible candidates

- GIVEN an indexed library with several bathroom images that satisfy the constraints
- WHEN the agent runs `pick <root> --category bathroom --query "bright naturally lit shower"`
- THEN the manifest includes a `ranking` block with `mode`, `reason`, `score`, and `alternatives`
- AND every ranked candidate and alternative already satisfied the category/orientation/dimension constraints

#### Scenario: Ranking records no usage

- GIVEN a `--query` ranking run in any semantic mode
- WHEN candidates are scored and a selection is returned
- THEN no usage record is written for the ranking step itself
- AND only a successful `pick` records usage against its slot and location

#### Scenario: No eligible candidate with query

- GIVEN no indexed image satisfies the constraints
- WHEN `pick` runs with `--query` and a semantic mode
- THEN the tool exits with the no-match code
- AND the result includes the closest alternatives and a `ranking` block whose reason is `no_candidate`

#### Scenario: Constraint-only path unchanged

- GIVEN a `pick` invocation with no `--query`
- WHEN the command runs
- THEN no ranking occurs and the manifest carries no `ranking` block
- AND the output matches the existing constraint-only behavior

### Requirement: Semantic Mode Selection

The system MUST expose `--semantic local|ai`, defaulting to `local`. AI mode MUST be selected explicitly. When `--query` is passed without `--semantic`, the system MUST default to `local` and MUST emit a non-fatal stderr note that the default was applied. Local mode MUST be deterministic: the same `--query` over the same index MUST yield the same order and selection with a stable tie-break, and MUST NOT call any provider.

#### Scenario: Query without semantic defaults to local

- GIVEN a `pick` invocation with `--query` but no `--semantic`
- WHEN the command runs
- THEN ranking uses local mode with no provider call
- AND a non-fatal stderr note reports that `--semantic local` was applied

#### Scenario: AI mode is explicit only

- GIVEN a `pick` invocation where `--semantic ai` is NOT passed
- WHEN the command runs
- THEN no AI provider request is made for ranking

#### Scenario: Local ranking is deterministic

- GIVEN the same index and the same `--query`
- WHEN local ranking runs twice
- THEN both runs return an identical ordered result and selection

### Requirement: Loud AI Ranking Failure

When `--semantic ai` is selected and ranking fails, the system MUST fail the command with a structured `ai_ranking_failed` reason and the provider-error exit code, and MUST NOT silently fall back to local ranking.

#### Scenario: AI ranking failure surfaces loudly

- GIVEN `--semantic ai` and a provider that returns a failure (rate-limit, timeout, refusal, or malformed output)
- WHEN ranking runs
- THEN the command exits with the provider-error code and reason `ai_ranking_failed`
- AND no local ranking result is substituted

### Requirement: Bounded Result Size

The system MUST accept `--top-k` with a default of `3` and a valid range of `1..10`, and MUST bound both the success-path `alternatives` and the `no_candidate` alternatives to that value. An out-of-range or non-numeric `--top-k` MUST be rejected as invalid input with the invalid-input exit code. Omitting `--top-k` MUST preserve the existing default of 3.

#### Scenario: Default top-k

- GIVEN a `--query` run with no `--top-k`
- WHEN ranking returns alternatives
- THEN at most 3 alternatives are emitted

#### Scenario: Configured top-k within range

- GIVEN `--top-k 5`
- WHEN ranking returns alternatives
- THEN at most 5 alternatives are emitted

#### Scenario: Invalid top-k rejected

- GIVEN `--top-k 0` or `--top-k 25`
- WHEN the command parses options
- THEN it exits with the invalid-input code and does not run ranking

### Requirement: External Image Source Selection

The system MUST accept `--source local|pixabay` on `pick`, defaulting to `local`. Selecting `pixabay` MUST be explicit; the system MUST NOT automatically fall back to `local` (or vice versa) when the selected source fails.

#### Scenario: Explicit Pixabay source is honored

- GIVEN `pick <root> --source pixabay --query "kitchen"`
- WHEN the command runs
- THEN the Pixabay search flow is used, not the local index

#### Scenario: A failed source never silently falls back

- GIVEN `--source pixabay` and a search that fails (missing credential, rate limit, or no candidate)
- WHEN the failure occurs
- THEN the command reports the specific failure
- AND it does NOT retry against the local index
