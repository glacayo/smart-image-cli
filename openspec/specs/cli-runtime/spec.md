# CLI Runtime Specification

## Purpose

Deliver an agent-friendly `img` command surface: machine-readable output, stable exit codes, safe path handling, and self-diagnostic `config`/`doctor` commands.

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

The system MUST provide a `doctor` command that verifies runtime prerequisites and provider reachability, and a `config` command to get/set/list provider settings.

#### Scenario: Doctor reports readiness

- GIVEN the tool is installed
- WHEN the agent runs `doctor`
- THEN it reports the status of runtime prerequisites and the configured provider
- AND a failing check yields a non-zero exit with an actionable message
