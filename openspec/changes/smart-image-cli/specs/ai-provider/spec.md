# AI Provider Specification

## Purpose

Provide a single provider-agnostic vision interface over OpenAI-compatible endpoints that returns structured classification JSON, protects tokens by pre-send downscaling, guards secrets, and surfaces typed errors.

## Requirements

### Requirement: Provider Abstraction

The system MUST expose one `VisionProvider` interface backed by OpenAI-compatible adapters, defaulting to Ollama Cloud, with OpenRouter and Gemini selectable by configuration only.

#### Scenario: Provider selected by config

- GIVEN a configured provider and model
- WHEN analysis needs a classification
- THEN the request is issued through the abstraction to the configured endpoint
- AND switching provider requires only config changes, not code changes

### Requirement: Structured JSON Output

The system MUST request and validate a strict JSON classification schema and MUST reject responses that fail the schema.

#### Scenario: Malformed response rejected

- GIVEN a provider returns non-conforming or non-JSON output
- WHEN the analyzer parses it
- THEN it MUST raise a typed error rather than persist an invalid record

### Requirement: Pre-Send Downscale

The system MUST downscale each image to a bounded size before sending it to the provider and MUST NOT transmit the original full-resolution file.

#### Scenario: Large image downscaled before send

- GIVEN an 8 MB source photo
- WHEN it is submitted for classification
- THEN a downscaled copy within the size bound is sent, not the original

### Requirement: Typed Error Surfacing

The system MUST surface provider timeouts, rate limits, refusals, and malformed output as distinct typed errors the caller can react to.

#### Scenario: Rate limit is recoverable

- GIVEN the provider returns a rate-limit response during a batch
- WHEN the analyzer handles it
- THEN it emits a typed rate-limit error and MAY retry with backoff without losing prior progress

### Requirement: Secret Handling

The system MUST store API keys in per-user configuration only and MUST NOT write keys into the project, sidecars, index, or logs.

#### Scenario: Key never leaks into project

- GIVEN a configured API key
- WHEN analysis runs and writes records
- THEN no project file, sidecar, index, or log line contains the key
