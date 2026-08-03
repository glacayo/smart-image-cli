# CLI Runtime Specification

## Purpose

Deliver an agent-friendly `smart-img` command surface: machine-readable output, stable exit codes, safe path handling, and self-diagnostic `config`/`doctor` commands.

## Requirements

### Requirement: Machine-Readable Output Mode

The system MUST emit a single structured JSON object on stdout when `--json` is passed or stdout is not a TTY, with all human status and diagnostics on stderr.

#### Scenario: Agent consumes JSON on stdout

- GIVEN a command run with stdout piped (non-TTY)
- WHEN it completes
- THEN stdout contains exactly one JSON object describing the result
- AND progress and status messages appear only on stderr

#### Scenario: Human mode stays readable

- GIVEN a command run in an interactive TTY without `--json`
- WHEN it completes
- THEN output is human-formatted while exposing the same result fields

### Requirement: Stable Exit Codes

The system MUST use stable, documented exit codes: `0` success, `2` no-match for `pick`, `3` invalid input, `4` provider error, `5` filesystem error.

#### Scenario: No-match is distinguishable from crash

- GIVEN a `pick` with no qualifying candidate
- WHEN it completes
- THEN the process exits with code `2`
- AND an unexpected crash uses a different, non-`2` code

#### Scenario: Invalid arguments reported

- GIVEN a command with a malformed flag or missing required argument
- WHEN it runs
- THEN it exits with code `3` and a structured input error

### Requirement: Path Safety

The system MUST resolve paths to absolute, reject inputs that escape `--root`, and sanitize generated filenames (normalize Unicode, strip reserved and unsafe characters).

#### Scenario: Traversal rejected

- GIVEN an argument that resolves outside `--root` via `../`
- WHEN the command validates paths
- THEN it exits with a filesystem/path-safety error and performs no writes

### Requirement: Environment Diagnostics and Config

The system MUST provide a `doctor` command that verifies runtime prerequisites and provider reachability, and a `config` command to get/set/list provider settings, run guided setup, and list provider models. `doctor` MUST report the actual active provider, endpoint, and model with their reachability status, and MUST redact secrets from all output. Setting an API key via `config` MUST trigger a connection test and report its outcome without echoing the key. Existing machine-readable output (`--json`/non-TTY) and exit-code contracts MUST remain intact for all new subcommands.

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
