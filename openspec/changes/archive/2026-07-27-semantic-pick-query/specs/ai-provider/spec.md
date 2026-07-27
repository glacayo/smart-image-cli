# Delta for AI Provider

## ADDED Requirements

### Requirement: Text-Only Metadata Ranking

The system MUST provide a text-only ranking contract that scores candidates using ONLY existing index metadata (`subject`, `title`, `description`, `altText`, `categories`). It MUST NOT transmit image bytes and MUST NOT re-read or re-analyze source images. For v1 it MUST reuse the already-configured provider and model.

#### Scenario: Ranking sends metadata only

- GIVEN a set of constraint-eligible candidates with indexed metadata
- WHEN AI ranking issues a provider request
- THEN the request payload contains only text metadata for each candidate
- AND no image bytes or image content are transmitted

#### Scenario: No re-analysis of images

- GIVEN candidates already present in the index
- WHEN AI ranking runs
- THEN no source image is re-read or re-classified through the vision path

### Requirement: Bounded Ranking Payload

The system MUST cap the number of candidates sent for AI ranking (default 25, hard cap 50) and MUST use a bounded prompt, so an unbounded library cannot drive unbounded provider spend.

#### Scenario: Oversized candidate set is capped

- GIVEN more constraint-eligible candidates than the configured cap
- WHEN AI ranking builds its request
- THEN only up to the cap of candidates is included in the payload

### Requirement: Ranking Prompt-Injection Guardrails

The system MUST treat candidate metadata as DATA, never as instructions, and MUST require a strict JSON ranking response of `{sha256, score, reason}` entries. The `reason` field MUST be length-bounded and passed through the secret redactor before emit. A non-conforming or non-JSON ranking response MUST raise a typed error rather than be trusted.

#### Scenario: Malicious metadata cannot inject instructions

- GIVEN a candidate whose description contains embedded instruction-like text
- WHEN AI ranking runs
- THEN the metadata is treated as data only and the response is still parsed as strict JSON
- AND the emitted `reason` is length-bounded and redacted

#### Scenario: Malformed ranking response rejected

- GIVEN the provider returns non-JSON or schema-violating ranking output
- WHEN the response is parsed
- THEN a typed error is raised and no ranking result is trusted

### Requirement: Reuse Provider Error Taxonomy for Ranking

Text ranking MUST surface failures through the existing typed provider errors (rate-limit, timeout, refusal, malformed output) so the caller can map them to `ai_ranking_failed`.

#### Scenario: Rate limit during ranking is typed

- GIVEN the provider returns a rate-limit response during ranking
- WHEN the ranker handles it
- THEN it emits the existing typed rate-limit error the caller can react to
