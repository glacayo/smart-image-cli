# Delta for Provider Setup

## ADDED Requirements

### Requirement: Guided Setup Flow

The system MUST provide `img config setup` guiding the user through provider choice, API key entry, connection test, model discovery, model selection, and persistence. The flow MUST also run non-interactively via flags with `--json`, honoring the existing machine-readable output contract, and MUST NOT prompt when stdin/stdout is not a TTY.

#### Scenario: Interactive happy path

- GIVEN a TTY session with no configured provider
- WHEN the user runs `img config setup` and completes provider, key, and model choices
- THEN the connection test passes and the selection is persisted to user-scoped config
- AND subsequent commands use the chosen provider and model without re-entry

#### Scenario: Non-interactive agent setup

- GIVEN a non-TTY invocation with provider, key, and model flags plus `--json`
- WHEN setup runs
- THEN it completes without prompting
- AND stdout contains exactly one JSON object describing the result

### Requirement: Key Validation Without Leakage

Setup MUST validate the entered API key against the provider using metadata endpoints only, MUST store it in user-scoped configuration, and MUST NOT print, log, or persist key material in the project. A failing validation MUST surface a typed, actionable error with exit code `4`.

#### Scenario: Invalid key rejected safely

- GIVEN an invalid API key entered during setup
- WHEN the connection test runs
- THEN a typed, actionable auth error is reported and the process exits with code `4`
- AND no stdout, stderr, log, or project file contains the key

### Requirement: Model Discovery With Fallback

Setup MUST list available models via the provider's OpenAI-compatible model discovery endpoint where available, and MUST offer manual model-id entry when discovery is unsupported or fails.

#### Scenario: Models listed for selection

- GIVEN a provider exposing a `/models`-equivalent endpoint and a valid key
- WHEN setup reaches model selection
- THEN discovered model ids are listed for the user to choose from

#### Scenario: Discovery unavailable

- GIVEN a provider whose model listing is unsupported or fails
- WHEN setup reaches model selection
- THEN the user MAY enter a model id manually and setup continues

### Requirement: Vision Capability Guidance

Setup MUST steer users toward known or likely image-capable models using provider metadata or curated hints, and MUST warn when a chosen model is unknown or likely non-vision. Capability detection MUST NOT issue paid image-analysis probes. Warnings MUST NOT block selection.

#### Scenario: Vision-capable models highlighted

- GIVEN a model list containing models with vision-capability signals
- WHEN setup presents the list
- THEN image-capable models are flagged as recommended for image analysis

#### Scenario: Non-vision candidate warned, not blocked

- GIVEN the user selects a model with no vision-capability signal
- WHEN setup confirms the selection
- THEN a warning states the model may not accept image input
- AND the selection is still persisted if the user confirms

### Requirement: Model Selection Persistence

Setup MUST persist the chosen provider and model to user-scoped configuration; project-level configuration MUST NOT receive secrets.

#### Scenario: Persisted selection reused

- GIVEN setup previously persisted a provider and model
- WHEN the user runs `img analyze`
- THEN the persisted provider and model are used without prompting
