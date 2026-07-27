import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { exiftool } from "exiftool-vendored";
import sharp from "sharp";
import { optimizeService } from "../../src/app/optimize-service.js";
import { rmWithRetry } from "../support/cleanup.js";

const roots: string[] = [];

afterEach(async () => {
  sharp.cache(false);
  await Promise.all(roots.map((root) => rmWithRetry(root)));
  roots.length = 0;
});

// The optimization tests use the real `exiftool-vendored` singleton (via
// `optimizeService` -> `new ExiftoolMetadata()` and the direct `exiftool`
// import for writing tags). The singleton spawns a long-lived native ExifTool
// process that keeps the test runner alive after the suite finishes. End it
// once after the whole file so no zombie process remains, while keeping the
// singleton available for every test in the file.
afterAll(async () => {
  await exiftool.end();
});

describe("Phase 4 optimization integration", () => {
  it("converts JPG to AVIF and leaves the source unchanged", async () => {
    const root = await tempRoot();
    const source = await writeJpeg(root, "photo.jpg", 800, 400);
    const before = await fs.readFile(source);

    const outcome = await optimizeService(root, "photo.jpg", { format: "avif" });

    expect(outcome.exitCode).toBe(0);
    const details = outcome.result.details as { asset: { relPath: string; format: string } };
    expect(details.asset.relPath).toBe("_out/photo.avif");
    expect(details.asset.format).toBe("avif");
    await expect(fs.readFile(source)).resolves.toEqual(before);
  });

  it("strips GPS and descriptive metadata by default", async () => {
    const root = await tempRoot();
    const source = await writeJpegWithPrivateExif(root, "gps.jpg", 400, 200);
    await expect(sharp(source).metadata()).resolves.toMatchObject({
      exif: expect.any(Buffer)
    });

    const outcome = await optimizeService(root, "gps.jpg", { format: "jpg", maxWidth: 200 });

    expect(outcome.exitCode).toBe(0);
    const output = path.join(root, "_out", "gps.jpg");
    const metadata = await sharp(output).metadata();
    expect(metadata.exif).toBeUndefined();
  });

  it("preserves writable metadata only when keep-metadata is explicit", async () => {
    const root = await tempRoot();
    await writeJpegWithCaptionExif(root, "captioned.jpg", 400, 200);

    const stripped = await optimizeService(root, "captioned.jpg", { format: "jpg", maxWidth: 200 });
    const kept = await optimizeService(root, "captioned.jpg", {
      format: "jpg",
      maxWidth: 200,
      keepMetadata: true
    });

    expect(stripped.exitCode).toBe(0);
    expect(kept.exitCode).toBe(0);
    const strippedMetadata = await sharp(path.join(root, "_out", "captioned.jpg")).metadata();
    const keptMetadata = await sharp(path.join(root, "_out", "captioned-002.jpg")).metadata();
    expect(strippedMetadata.exif).toBeUndefined();
    expect(keptMetadata.exif).toEqual(expect.any(Buffer));
    expect(keptMetadata.exif?.includes(Buffer.from("public caption"))).toBe(true);
  });

  it("normalizes EXIF orientation so the optimized output has normalized dimensions and no orientation tag", async () => {
    // EXIF orientation 6 means "rotate 90° CW for display". A 80x40 source
    // displayed rotated becomes 40x80 visually. After sharp's `.rotate()`
    // bakes the rotation in, the output MUST NOT carry an orientation tag —
    // proving the rotation was applied, not merely stripped while leaving
    // pixels unrotated.
    //
    // We prove the rotation was actually applied (not just that the tag is
    // absent) by comparing against a non-rotated control: a same-size source
    // with no orientation tag produces an 80x40 output (resize-to-fit within
    // the pre-rotation 80x40 plan = identity), while the rotated source
    // produces a different dimension because the pixels were rotated before
    // the resize. A vacuous "orientation is undefined" assertion would pass
    // even if `.rotate()` were a no-op; this dimension-difference assertion
    // would fail.
    const root = await tempRoot();
    await writeJpeg(root, "rotated.jpg", 80, 40);
    await writeTags(path.join(root, "rotated.jpg"), { Orientation: 6 });
    // Control: same size, no orientation tag.
    await writeJpeg(root, "control.jpg", 80, 40);

    const outcome = await optimizeService(root, "rotated.jpg", { format: "jpg" });
    const control = await optimizeService(root, "control.jpg", { format: "jpg" });

    expect(outcome.exitCode).toBe(0);
    expect(control.exitCode).toBe(0);
    const rotatedMeta = await sharp(path.join(root, "_out", "rotated.jpg")).metadata();
    const controlMeta = await sharp(path.join(root, "_out", "control.jpg")).metadata();
    // Orientation tag must be gone (rotation baked into pixels).
    expect(rotatedMeta.orientation).toBeUndefined();
    // The rotated output dimensions MUST differ from the non-rotated control,
    // proving `.rotate()` applied the EXIF orientation rather than being a
    // no-op. (Pre-rotation 80x40 -> rotated 40x80 -> resize-to-fit 80x40
    // yields a different size than the unrotated 80x40 -> resize-to-fit 80x40.)
    expect({ w: rotatedMeta.width, h: rotatedMeta.height }).not.toEqual({
      w: controlMeta.width,
      h: controlMeta.height
    });
  });

  it("reports target_exceeds_source when requested dimensions would upscale", async () => {
    const root = await tempRoot();
    await writeJpeg(root, "small.jpg", 1200, 600);

    const outcome = await optimizeService(root, "small.jpg", { format: "webp", width: 1800 });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("target_exceeds_source");
    await expect(fs.stat(path.join(root, "_out"))).rejects.toThrow();
  });

  it("downscales within requested bounds without distortion", async () => {
    const root = await tempRoot();
    await writeJpeg(root, "wide.jpg", 4000, 2000);

    const outcome = await optimizeService(root, "wide.jpg", { format: "webp", maxWidth: 1600 });

    expect(outcome.exitCode).toBe(0);
    const metadata = await sharp(path.join(root, "_out", "wide.webp")).metadata();
    expect(metadata.width).toBe(1600);
    expect(metadata.height).toBe(800);
  });
});

async function writeJpeg(root: string, rel: string, width: number, height: number): Promise<string> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: "white" } }).jpeg().toFile(file);
  return file;
}

async function writeJpegWithPrivateExif(
  root: string,
  rel: string,
  width: number,
  height: number
): Promise<string> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: "white" } })
    .jpeg()
    .withExif({
      IFD0: {
        ImageDescription: "private location"
      },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "12/1 20/1 2400/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "56/1 46/1 4800/100"
      }
    })
    .toFile(file);
  return file;
}

async function writeJpegWithCaptionExif(
  root: string,
  rel: string,
  width: number,
  height: number
): Promise<string> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: "white" } })
    .jpeg()
    .withExif({
      IFD0: {
        ImageDescription: "public caption"
      }
    })
    .toFile(file);
  return file;
}

async function writeTags(filePath: string, tags: Record<string, unknown>): Promise<void> {
  // `-n` writes numeric tag values bypassing ExifTool's PrintConv, so numeric
  // tags like Orientation (6) are stored as the raw int instead of the
  // print-converted string ("Rotate 90 CW"). Without `-n`, ExifTool rejects
  // `Orientation: 6` with "Can't convert IFD0:Orientation (not in PrintConv)"
  // and the tag is never written — which would make the rotation test vacuous
  // (sharp would see no orientation and `.rotate()` would be a no-op).
  await exiftool.write(filePath, tags, ["-overwrite_original", "-n"]);
  await fs.rm(`${filePath}_original`, { force: true }).catch(() => undefined);
}

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-opt-"));
  roots.push(root);
  return root;
}
