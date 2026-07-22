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

The system MUST NOT upscale a candidate to reach requested dimensions and MUST NOT fabricate a match from an unfit image.

#### Scenario: Undersized candidate rejected

- GIVEN the only category match is smaller than the requested width and height
- WHEN `pick` runs
- THEN that image is NOT upscaled and NOT returned as a match
- AND the request is treated as a no-match with alternatives

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
