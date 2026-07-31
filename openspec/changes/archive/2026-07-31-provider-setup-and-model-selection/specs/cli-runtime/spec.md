# Delta for CLI Runtime

## MODIFIED Requirements

### Requirement: Environment Diagnostics and Config

The system MUST provide a `doctor` command that verifies runtime prerequisites and provider reachability, and a `config` command to get/set/list provider settings, run guided setup, and list provider models. `doctor` MUST report the actual active provider, endpoint, and model with their reachability status, and MUST redact secrets from all output. Setting an API key via `config` MUST trigger a connection test and report its outcome without echoing the key. Existing machine-readable output (`--json`/non-TTY) and exit-code contracts MUST remain intact for all new subcommands.
(Previously: doctor verified prerequisites and generic provider reachability; config only supported get/set/list with no setup flow, model listing, or key-set connection test.)

#### Scenario: Doctor reports readiness

- GIVEN the tool is installed
- WHEN the agent runs `doctor`
- THEN it reports the status of runtime prerequisites and the configured provider
- AND a failing check yields a non-zero exit with an actionable message

#### Scenario: Doctor shows active provider detail, redacted

- GIVEN a configured provider, endpoint, model, and API key
- WHEN `doctor` runs
- THEN output includes the active provider, endpoint, model, and their reachability status
- AND no key material appears in any output

#### Scenario: Unreachable model reported

- GIVEN a configured model the provider no longer serves
- WHEN `doctor` runs
- THEN the model check fails with an actionable message pointing to `config setup`

#### Scenario: Key set triggers connection test

- GIVEN a user sets an API key via `config`
- WHEN the command completes
- THEN a connection test outcome is reported (stderr in human mode, result fields in JSON mode)
- AND the key is persisted user-scoped and never echoed
