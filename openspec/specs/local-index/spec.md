# Local Index Specification

## Purpose

Maintain a fast, queryable, project-local record of analyzed images, their classification, the shipped/extendable taxonomy, and slot usage — durable via sidecars and rebuildable on demand.

## Requirements

### Requirement: Project-Local State

The system MUST confine all generated index, sidecar, thumbnail, and usage state to a single folder under the analyzed `--root`, and MUST NOT write index state elsewhere on the machine.

#### Scenario: State stays inside the project

- GIVEN `analyze <root>` runs
- WHEN it writes its index and usage state
- THEN all such files live under `<root>`'s index folder
- AND removing that folder leaves no residual global state

### Requirement: Rebuildable Index From Sidecars

The system MUST treat per-image JSON sidecars as the durable source of truth and the queryable database as a derived view that can be regenerated from sidecars and source files.

#### Scenario: Database rebuilt after loss

- GIVEN the index database is deleted but sidecars remain
- WHEN the index is rebuilt
- THEN every previously analyzed image is restored to the queryable index from its sidecar

### Requirement: Shipped and Extendable Taxonomy

The system MUST ship a default category taxonomy and MUST allow it to be extended per project without code changes.

#### Scenario: Default taxonomy available

- GIVEN a fresh project with no custom categories
- WHEN `analyze` runs
- THEN classification draws from the shipped default taxonomy

#### Scenario: Per-project extension honored

- GIVEN a project that declares an additional category in its config
- WHEN `analyze` runs
- THEN the extended category is a valid classification target alongside the defaults

### Requirement: Queryable Usage State

The system MUST persist slot usage keyed by image, free-text slot, and location so selection can enforce reuse rules.

#### Scenario: Usage query reflects recorded picks

- GIVEN an image recorded as used for a given slot and location
- WHEN the index is queried for that slot and location
- THEN the used image is reported as consumed for that slot+location

### Requirement: Change-Aware Records

The system MUST key records by `sha256`; when a file's content changes it MUST be treated as a new image while prior sidecars are retained for audit.

#### Scenario: Edited image becomes a new record

- GIVEN a previously analyzed image whose bytes change
- WHEN `analyze` runs again
- THEN a new record is created under the new `sha256` and the old sidecar is retained
