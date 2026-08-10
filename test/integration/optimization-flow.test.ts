import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { optimizeService } from "../../src/app/optimize-service.js";
import { rmWithRetry } from "../support/cleanup.js";

const roots: string[] = [];
const thisFile = fileURLToPath(import.meta.url);

afterEach(async () => {
  sharp.cache(false);
  await Promise.all(roots.map((root) => rmWithRetry(root)));
  roots.length = 0;
});

afterAll(async () => {
  const { exiftool: ep } = await import("exiftool-vendored");
  await ep.end();
});

describe("Phase 4 optimization integration", () => {
  it("does not plant EXIF fixtures via live exiftool in this suite", () => {
    // CRIT-004: under full-suite load, native ExifTool fixture planting pushed
    // the orientation case past Vitest's default 5000ms. Keep planting pure JS.
    const source = fs.readFileSync(thisFile, "utf8");
    const codeOnly = source
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
      })
      .join("\n");
    expect(codeOnly).not.toMatch(/from\s+["']exiftool-vendored["']/);
    expect(codeOnly).not.toMatch(/\bexiftool\s*\./);
    expect(codeOnly).toMatch(/ORIENTATION_6_JPEG_BASE64/);
    expect(codeOnly).toMatch(/writeOrientation6Jpeg/);
  });

  it("converts JPG to AVIF and leaves the source unchanged", async () => {
    const root = await tempRoot();
    const source = await writeJpeg(root, "photo.jpg", 800, 400);
    const before = await fsp.readFile(source);

    const outcome = await optimizeService(root, "photo.jpg", { format: "avif" });

    expect(outcome.exitCode).toBe(0);
    const details = outcome.result.details as { asset: { relPath: string; format: string } };
    expect(details.asset.relPath).toBe("_out/photo.avif");
    expect(details.asset.format).toBe("avif");
    await expect(fsp.readFile(source)).resolves.toEqual(before);
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
    // Keep this service-level regression deterministic: the ExifTool-backed
    // adapter has dedicated coverage, while this test only needs to prove that
    // `optimizeService` reads/reapplies metadata on explicit opt-in and keeps
    // the default path stripped.
    const metadata = {
      read: vi.fn(async () => ({ ImageDescription: "public caption" })),
      reapplyTags: vi.fn(async (filePath: string, tags: Record<string, unknown>) => {
        const caption = tags.ImageDescription;
        if (typeof caption === "string") {
          await writeCaptionExif(filePath, caption);
        }
      })
    };

    const stripped = await optimizeService(
      root,
      "captioned.jpg",
      { format: "jpg", maxWidth: 200 },
      { metadata }
    );
    const kept = await optimizeService(
      root,
      "captioned.jpg",
      {
        format: "jpg",
        maxWidth: 200,
        keepMetadata: true
      },
      { metadata }
    );

    expect(stripped.exitCode).toBe(0);
    expect(kept.exitCode).toBe(0);
    expect(metadata.read).toHaveBeenCalledTimes(1);
    expect(metadata.read).toHaveBeenCalledWith(path.join(root, "captioned.jpg"));
    expect(metadata.reapplyTags).toHaveBeenCalledTimes(1);
    expect(metadata.reapplyTags).toHaveBeenCalledWith(
      path.join(root, "_out", "captioned-002.jpg"),
      {
        ImageDescription: "public caption"
      }
    );
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
    //
    // Fixture planting uses an embedded JPEG with Orientation=6 already baked
    // in. Sharp's withExif normalizes Orientation to 1 on write, and a live
    // exiftool.write under full-suite load is what caused CRIT-004 timeouts.
    const root = await tempRoot();
    const rotatedPath = await writeOrientation6Jpeg(root, "rotated.jpg");
    const planted = await sharp(rotatedPath).metadata();
    expect(planted.orientation).toBe(6);
    expect(planted.width).toBe(80);
    expect(planted.height).toBe(40);
    // Control: same stored size, no orientation tag.
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
    await expect(fsp.stat(path.join(root, "_out"))).rejects.toThrow();
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

/**
 * Tiny 80x40 JPEG with EXIF Orientation=6 already present. Generated once via
 * sharp+exiftool offline; embedded so this suite never spawns native ExifTool
 * just to plant a fixture (CRIT-004 root cause under full-suite load).
 */
const ORIENTATION_6_JPEG_BASE64 =
  "/9j/4QAuRXhpZgAATU0AKgAAAAgAAgESAAMAAAABAAYAAAITAAMAAAABAAEAAAAAAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAoAFADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAcJ/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AnQBDGqYAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2Q==";

async function writeOrientation6Jpeg(root: string, rel: string): Promise<string> {
  const file = path.join(root, rel);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, Buffer.from(ORIENTATION_6_JPEG_BASE64, "base64"));
  return file;
}

async function writeJpeg(
  root: string,
  rel: string,
  width: number,
  height: number
): Promise<string> {
  const file = path.join(root, rel);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: "white" } })
    .jpeg()
    .toFile(file);
  return file;
}

async function writeJpegWithPrivateExif(
  root: string,
  rel: string,
  width: number,
  height: number
): Promise<string> {
  const file = path.join(root, rel);
  await fsp.mkdir(path.dirname(file), { recursive: true });
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
  await fsp.mkdir(path.dirname(file), { recursive: true });
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

async function writeCaptionExif(filePath: string, caption: string): Promise<void> {
  const input = await fsp.readFile(filePath);
  const withCaption = await sharp(input)
    .jpeg()
    .withExif({
      IFD0: {
        ImageDescription: caption
      }
    })
    .toBuffer();
  await fsp.writeFile(filePath, withCaption);
}

async function tempRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "smart-image-opt-"));
  roots.push(root);
  return root;
}
