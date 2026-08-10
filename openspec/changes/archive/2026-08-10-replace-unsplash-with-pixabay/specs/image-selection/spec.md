# Delta for Image Selection

## ADDED Requirements

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

## MODIFIED Requirements

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
