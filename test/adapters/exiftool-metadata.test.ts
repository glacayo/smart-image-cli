import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { exiftool } from "exiftool-vendored";
import sharp from "sharp";
import {
  ExiftoolMetadata,
  MetadataError,
  type ExiftoolSeam
} from "../../src/adapters/exiftool-metadata.js";
import { rmWithRetry } from "../support/cleanup.js";

const roots: string[] = [];

// Native ExifTool startup plus JPEG read/write I/O can exceed Vitest's default
// timeout on Windows; keep the longer deadline scoped to native adapter seams.
const NATIVE_EXIFTOOL_TEST_TIMEOUT_MS = 40_000;

afterEach(async () => {
  await Promise.all(roots.map((root) => rmWithRetry(root)));
  roots.length = 0;
});

afterAll(async () => {
  await exiftool.end();
});

describe("ExiftoolMetadata", () => {
  it("stripAll cleans up _original backup even when exiftool write fails", async () => {
    const root = await tempRoot();
    const input = path.join(root, "photo.jpg");
    await fs.writeFile(input, "fake image", "utf8");

    // Simulate exiftool creating an _original backup then failing.
    const failingSeam: ExiftoolSeam = {
      read: vi.fn(),
      write: vi.fn(async (filePath: string) => {
        // ExifTool created a backup before failing.
        await fs.writeFile(`${filePath}_original`, "private metadata backup", "utf8");
        throw new Error("exiftool write failed catastrophically");
      })
    };

    const metadata = new ExiftoolMetadata(undefined, failingSeam);
    await expect(metadata.stripAll(input)).rejects.toBeInstanceOf(MetadataError);

    // The privacy-leaking _original backup MUST have been cleaned up.
    await expect(fs.access(`${input}_original`)).rejects.toThrow();
  });

  it("stripAll cleans up _original backup on success too", async () => {
    const root = await tempRoot();
    const input = path.join(root, "photo.jpg");
    await fs.writeFile(input, "fake image", "utf8");

    const successSeam: ExiftoolSeam = {
      read: vi.fn(),
      write: vi.fn(async (filePath: string) => {
        // Simulate exiftool creating an _original despite overwrite flag.
        await fs.writeFile(`${filePath}_original`, "leftover backup", "utf8");
        return { created: 0, updated: 1, unchanged: 0 };
      })
    };

    const metadata = new ExiftoolMetadata(undefined, successSeam);
    await metadata.stripAll(input);

    // No backup should persist.
    await expect(fs.access(`${input}_original`)).rejects.toThrow();
  });

  it("reapplyTags is a no-op when no writable tags remain", async () => {
    const root = await tempRoot();
    const input = path.join(root, "photo.jpg");
    await fs.writeFile(input, "fake image", "utf8");

    const writeSpy = vi.fn();
    const seam: ExiftoolSeam = {
      read: vi.fn(),
      write: writeSpy.mockResolvedValue({ created: 0, updated: 0, unchanged: 1 })
    };

    const metadata = new ExiftoolMetadata(undefined, seam);
    // Tags with only filtered keys (SourceFile, errors, undefined) -> no writable.
    await metadata.reapplyTags(input, { SourceFile: "x", errors: "y", empty: undefined });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("reapplyTags filters non-writable read-only/system tags before writing", async () => {
    // Regression: ExifTool read tags include read-only/system fields
    // (Directory, FileName, FileSize, FileType, MIMEType, ImageWidth,
    // ImageHeight, ExifToolVersion, …) that cannot be written back. The
    // adapter MUST filter them before reapply so `--keep-metadata` does not
    // attempt to write `FileName`/`Directory`/etc. into optimized outputs
    // (which ExifTool would reject or silently misapply).
    const root = await tempRoot();
    const input = path.join(root, "photo.jpg");
    await fs.writeFile(input, "fake image", "utf8");

    let writtenTags: Record<string, unknown> | undefined;
    const seam: ExiftoolSeam = {
      read: vi.fn(),
      write: vi.fn(async (_file: string, tags: Record<string, unknown>) => {
        writtenTags = tags;
        return { created: 0, updated: 1, unchanged: 0 };
      })
    };

    const metadata = new ExiftoolMetadata(undefined, seam);
    await metadata.reapplyTags(input, {
      // Writable tag that MUST survive the filter.
      ImageDescription: "public caption",
      // Read-only/system tags that MUST be filtered out before write.
      SourceFile: "/tmp/photo.jpg",
      Directory: "/tmp",
      FileName: "photo.jpg",
      FileSize: 1234,
      FileType: "JPEG",
      FileTypeExtension: "jpg",
      MIMEType: "image/jpeg",
      ExifToolVersion: 12.4,
      ImageWidth: 200,
      ImageHeight: 100,
      Megapixels: 0.02,
      EncodingProcess: "Baseline DCT",
      BitsPerSample: 8,
      ColorComponents: 3,
      YCbCrSubSampling: "4:2:0"
    });

    expect(writtenTags).toBeDefined();
    // The writable tag survives.
    expect(writtenTags).toHaveProperty("ImageDescription", "public caption");
    // None of the read-only/system tags are passed to the write seam.
    const filteredKeys = [
      "SourceFile",
      "Directory",
      "FileName",
      "FileSize",
      "FileType",
      "FileTypeExtension",
      "MIMEType",
      "ExifToolVersion",
      "ImageWidth",
      "ImageHeight",
      "Megapixels",
      "EncodingProcess",
      "BitsPerSample",
      "ColorComponents",
      "YCbCrSubSampling"
    ];
    for (const key of filteredKeys) {
      expect(writtenTags).not.toHaveProperty(key);
    }
  });

  it(
    "reads and reapplies writable metadata with the native ExifTool adapter",
    async () => {
      const root = await tempRoot();
      const source = await writeJpegWithCaption(root, "source.jpg", "native public caption");
      const target = await writeJpeg(root, "target.jpg");
      const metadata = new ExiftoolMetadata();

      const sourceTags = await metadata.read(source);
      await metadata.reapplyTags(target, sourceTags);
      const targetTags = await metadata.read(target);

      expect(sourceTags).toHaveProperty("ImageDescription", "native public caption");
      expect(targetTags).toHaveProperty("ImageDescription", "native public caption");
    },
    NATIVE_EXIFTOOL_TEST_TIMEOUT_MS
  );

  it("read wraps exiftool errors as MetadataError", async () => {
    const root = await tempRoot();
    const input = path.join(root, "photo.jpg");
    await fs.writeFile(input, "fake image", "utf8");

    const seam: ExiftoolSeam = {
      read: vi.fn().mockRejectedValue(new Error("cannot read file")),
      write: vi.fn()
    };

    const metadata = new ExiftoolMetadata(undefined, seam);
    await expect(metadata.read(input)).rejects.toBeInstanceOf(MetadataError);
  });

  it("read rejects with MetadataError when the seam never resolves before the deadline", async () => {
    const root = await tempRoot();
    const input = path.join(root, "photo.jpg");
    await fs.writeFile(input, "fake image", "utf8");

    // A never-resolving seam simulates a hung ExifTool process.
    const neverResolvingSeam: ExiftoolSeam = {
      read: vi.fn(() => new Promise(() => undefined)),
      write: vi.fn()
    };

    const metadata = new ExiftoolMetadata(undefined, neverResolvingSeam, {
      timeoutMs: 50
    });
    const start = Date.now();
    await expect(metadata.read(input)).rejects.toBeInstanceOf(MetadataError);
    // It must actually have timed out (~50ms), not hang forever.
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("stripAll rejects with MetadataError when the seam never resolves before the deadline", async () => {
    const root = await tempRoot();
    const input = path.join(root, "photo.jpg");
    await fs.writeFile(input, "fake image", "utf8");

    const neverResolvingSeam: ExiftoolSeam = {
      read: vi.fn(),
      write: vi.fn(() => new Promise(() => undefined))
    };

    const metadata = new ExiftoolMetadata(undefined, neverResolvingSeam, {
      timeoutMs: 50
    });
    await expect(metadata.stripAll(input)).rejects.toBeInstanceOf(MetadataError);
  });

  it("reapplyTags rejects with MetadataError when the seam never resolves before the deadline", async () => {
    const root = await tempRoot();
    const input = path.join(root, "photo.jpg");
    await fs.writeFile(input, "fake image", "utf8");

    const neverResolvingSeam: ExiftoolSeam = {
      read: vi.fn(),
      write: vi.fn(() => new Promise(() => undefined))
    };

    const metadata = new ExiftoolMetadata(undefined, neverResolvingSeam, {
      timeoutMs: 50
    });
    await expect(metadata.reapplyTags(input, { Make: "TestCam" })).rejects.toBeInstanceOf(
      MetadataError
    );
  });
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-exif-"));
  roots.push(root);
  return root;
}

async function writeJpeg(root: string, rel: string): Promise<string> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width: 12, height: 8, channels: 3, background: "white" } })
    .jpeg()
    .toFile(file);
  return file;
}

async function writeJpegWithCaption(root: string, rel: string, caption: string): Promise<string> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width: 12, height: 8, channels: 3, background: "white" } })
    .jpeg()
    .withExif({
      IFD0: {
        ImageDescription: caption
      }
    })
    .toFile(file);
  return file;
}
