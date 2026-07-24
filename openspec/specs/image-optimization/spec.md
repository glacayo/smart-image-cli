# Image Optimization Specification

## Purpose

Produce web-ready assets: convert format, resize/crop within source bounds, normalize orientation, and strip privacy-leaking metadata by default — without ever inventing pixels.

## Requirements

### Requirement: Format Conversion

The system MUST convert images to any of JPG, PNG, WebP, or AVIF on request, applying sensible per-format quality defaults.

#### Scenario: Convert to AVIF

- GIVEN a source JPG
- WHEN the agent runs `optimize <root> photo.jpg --format avif`
- THEN an AVIF asset is produced with the configured default quality
- AND the source file is left unchanged

### Requirement: Metadata and ICC Stripping by Default

The system MUST strip all EXIF/XMP/IPTC metadata (including GPS) and the ICC color profile from optimized outputs by default.

#### Scenario: GPS removed from output

- GIVEN a geotagged source photo
- WHEN it is optimized with default flags
- THEN the output contains no EXIF, GPS, XMP, IPTC, or ICC data

#### Scenario: Metadata retained only on explicit opt-in

- GIVEN an optimize invocation with an explicit keep-metadata flag
- WHEN it runs
- THEN metadata is preserved; otherwise stripping is the default behavior

### Requirement: EXIF Orientation Normalization

The system MUST apply EXIF orientation during decode so no output is stored sideways.

#### Scenario: Rotated capture normalized

- GIVEN a source photo whose EXIF orientation marks it rotated 90°
- WHEN it is optimized
- THEN the output pixels are upright and no orientation tag is required to display it correctly

### Requirement: No Upscaling

The system MUST NOT enlarge an image beyond its native pixel dimensions during resize or crop.

#### Scenario: Requested size exceeds source

- GIVEN a source that is 1200px wide
- WHEN optimize is asked for a 1800px-wide output
- THEN the tool MUST NOT upscale and MUST report that the target exceeds source bounds

### Requirement: Bounded Resize and Crop

The system MUST resize or crop within source dimensions, applying orientation-aware cropping to reach a requested aspect ratio.

#### Scenario: Downscale within bounds

- GIVEN a 4000px-wide source and a `--max-width 1600` request
- WHEN optimize runs
- THEN the output is 1600px wide with preserved aspect ratio and no distortion
