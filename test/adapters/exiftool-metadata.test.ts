import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExiftoolMetadata,
  MetadataError,
  type ExiftoolSeam
} from "../../src/adapters/exiftool-metadata.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
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
    await expect(
      metadata.reapplyTags(input, { Make: "TestCam" })
    ).rejects.toBeInstanceOf(MetadataError);
  });
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-exif-"));
  roots.push(root);
  return root;
}