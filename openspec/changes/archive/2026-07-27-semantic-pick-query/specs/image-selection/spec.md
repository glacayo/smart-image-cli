# Delta for Image Selection

## ADDED Requirements

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
