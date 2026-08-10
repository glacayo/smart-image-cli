# Delta for CLI Runtime

## ADDED Requirements

### Requirement: Pixabay Environment Override and Redaction Guarantee

The `PIXABAY_API_KEY` environment variable MUST be honored as an operator-managed runtime override, resolved ahead of the per-developer user-config key. `config` and `doctor` output MUST NOT ever include the raw Pixabay key.

#### Scenario: Operator env override takes precedence

- GIVEN `PIXABAY_API_KEY` set in the environment and a different key in user-config
- WHEN `pick --source pixabay` resolves credentials
- THEN the environment value is used

#### Scenario: Config and doctor output stay key-free

- GIVEN a configured Pixabay key
- WHEN `config` or `doctor` emits output
- THEN no output field contains the raw key value

## MODIFIED Requirements

### Requirement: Stable Exit Codes

The system MUST use stable, documented exit codes: `0` success, `2` no-match for `pick`, `3` invalid input, `4` provider error, `5` filesystem error.
(Previously: identical; adds an explicit removed-source contract.)

#### Scenario: No-match is distinguishable from crash

- GIVEN a `pick` with no qualifying candidate
- WHEN it completes
- THEN the process exits with code `2`
- AND an unexpected crash uses a different, non-`2` code

#### Scenario: Invalid arguments reported

- GIVEN a command with a malformed flag or missing required argument
- WHEN it runs
- THEN it exits with code `3` and a structured input error

#### Scenario: Removed Unsplash surface rejected without migration

- GIVEN `--source unsplash` or a `config unsplash` action, both removed and never shipped
- WHEN the command runs
- THEN it exits with code `3` as unrecognized input
- AND no fallback or Unsplash-specific migration guidance is produced
