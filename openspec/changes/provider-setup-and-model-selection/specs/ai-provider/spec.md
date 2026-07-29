# Delta for AI Provider

## ADDED Requirements

### Requirement: Model Discovery and Connection Test

Each provider adapter (ollama, openrouter, gemini) MUST expose a `listModels()` contract and a connection/key test that use metadata endpoints only (`/v1/models` equivalents). These calls MUST NOT transmit image bytes and MUST NOT incur analysis spend. Adapters without discovery support MUST report the capability as unavailable rather than fail.

#### Scenario: Models discovered via metadata endpoint

- GIVEN a configured provider with a valid key
- WHEN `listModels()` runs
- THEN model ids are returned from the metadata endpoint only
- AND vision-capability hints are included where the provider exposes them

#### Scenario: Connection test with invalid key

- GIVEN an invalid or missing API key
- WHEN the connection test runs
- THEN a typed auth error is returned
- AND no key material appears in the error or logs

### Requirement: Verified Vision-Capable Default

The default model MUST be a vision-capable model id verified reachable on the default provider. The broken `llama3.2-vision` default MUST be replaced.

#### Scenario: Fresh install analyzes without 404

- GIVEN a fresh install with only an API key configured
- WHEN `img analyze` runs with the default model
- THEN the request does not fail with a model-not-found error

## MODIFIED Requirements

### Requirement: Typed Error Surfacing

The system MUST surface provider timeouts, rate limits, refusals, malformed output, and endpoint/model not-found conditions as distinct typed errors the caller can react to. Not-found conditions (HTTP 404 on endpoint or model) MUST be distinguished from malformed output where the provider response allows it, and MUST carry an actionable message naming the missing model or endpoint.
(Previously: typed errors covered timeouts, rate limits, refusals, and malformed output only; 404s were not a distinct type.)

#### Scenario: Rate limit is recoverable

- GIVEN the provider returns a rate-limit response during a batch
- WHEN the analyzer handles it
- THEN it emits a typed rate-limit error and MAY retry with backoff without losing prior progress

#### Scenario: Unknown model distinguished from malformed output

- GIVEN a configured model id the provider does not serve
- WHEN a request returns a not-found response
- THEN a typed model-not-found error names the model and points to setup/discovery
- AND it is not reported as malformed output
