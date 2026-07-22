# Image Analysis Specification

## Purpose

Turn a raw client folder dump into a curated, classified library: recursively scan, deduplicate, AI-classify, rename, organize into category folders, and write durable records — safely and idempotently.

## Requirements

### Requirement: Recursive Image Discovery

The system MUST recursively scan the provided `--root` for supported raster formats (JPG, PNG, WebP, AVIF, TIFF) and MUST NOT read or write outside `--root`.

#### Scenario: Nested folders discovered

- GIVEN a `--root` containing images in nested subfolders
- WHEN the agent runs `analyze <root>`
- THEN every supported image under `--root` is enumerated as an analysis candidate
- AND non-image and unsupported files are ignored without error

#### Scenario: Path escape rejected

- GIVEN a candidate path that resolves outside `--root`
- WHEN discovery evaluates it
- THEN the tool MUST refuse to process it and report a path-safety error

### Requirement: Content-Based Deduplication

The system MUST compute a `sha256` per file and MUST deduplicate before any AI call so identical bytes are analyzed once.

#### Scenario: Duplicates collapsed before AI

- GIVEN a folder with three byte-identical copies of one photo
- WHEN `analyze` runs
- THEN the AI provider is invoked at most once for that content
- AND all duplicate paths resolve to the same `sha256` record

### Requirement: AI Classification

The system MUST obtain, per unique image, a structured classification containing subject, one or more categories from the shipped taxonomy, orientation, alt text, title, description, and a suggested slug.

#### Scenario: Image classified into taxonomy

- GIVEN an unclassified kitchen photo and a configured provider
- WHEN `analyze` processes it
- THEN the record stores orientation and at least one category drawn only from the shipped/extended taxonomy
- AND alt, title, and description fields are populated

### Requirement: Rename and Organize by Default

The system MUST, by default, rename each image to a stable sanitized slug and move it into a folder named for its primary category; it MUST NOT overwrite an existing file.

#### Scenario: Default run renames and organizes

- GIVEN a file `IMG_2931.JPG` classified as `kitchen-remodeling`
- WHEN `analyze <root>` runs with default flags
- THEN the file is renamed to a stable slug and placed under a `kitchen-remodeling/` folder
- AND a slug collision produces a unique name, never a silent overwrite

#### Scenario: Dry run makes no changes

- GIVEN `analyze <root> --dry-run`
- WHEN it completes
- THEN no file is renamed, moved, or written and the planned actions are reported

### Requirement: Durable Sidecars

The system MUST write one JSON sidecar per analyzed image capturing its classification, `sha256`, dimensions, original filename, and analyzer model.

#### Scenario: Sidecar persisted per image

- GIVEN a newly analyzed image
- WHEN `analyze` completes
- THEN a sidecar keyed by `sha256` exists under the project index folder containing the classification fields

### Requirement: Idempotent Re-Analysis

The system MUST NOT re-invoke the AI provider for an image whose `sha256` already has a sidecar, and re-running `analyze` MUST be safe.

#### Scenario: Second run reuses cache

- GIVEN a folder already analyzed once
- WHEN `analyze` runs again with no file changes
- THEN no new AI calls are made and existing records are preserved
