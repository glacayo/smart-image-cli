import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  DecodeError,
  SharpProcessor,
  WriteError
} from "../../src/adapters/sharp-processor.js";
import { planResize } from "../../src/domain/resize-planner.js";
import { StorageRootGuard, StorageRootGuardError } from "../../src/adapters/storage-root-guard.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("SharpProcessor", () => {
  it("probes a real generated image and returns dimensions", async () => {
    const root = await tempRoot();
    const input = path.join(root, "input.jpg");
    await sharp({ create: { width: 200, height: 100, channels: 3, background: "red" } })
      .jpeg()
      .toFile(input);

    const processor = new SharpProcessor();
    const info = await processor.probe(input);
    expect(info.width).toBe(200);
    expect(info.height).toBe(100);
    expect(info.format).toBe("jpg");
  });

  it("surfaces a DecodeError when probing invalid image bytes", async () => {
    const root = await tempRoot();
    const input = path.join(root, "not-an-image.jpg");
    await fs.writeFile(input, Buffer.from("this is not image data"), "utf8");

    const processor = new SharpProcessor();
    await expect(processor.probe(input)).rejects.toBeInstanceOf(DecodeError);
  });

  it("produces a downscaled jpg and reports output metadata", async () => {
    const root = await tempRoot();
    const input = path.join(root, "input.jpg");
    const output = path.join(root, "out", "small.jpg");
    await sharp({ create: { width: 800, height: 600, channels: 3, background: "blue" } })
      .jpeg()
      .toFile(input);

    const processor = new SharpProcessor();
    const plan = planResize(
      { width: 800, height: 600 },
      { format: "jpg", maxWidth: 400 }
    );
    if (!plan.ok) {
      expect.fail("plan should be satisfiable");
    }
    const asset = await processor.produce(input, output, plan);
    expect(asset.width).toBe(400);
    expect(asset.height).toBe(300);
    expect(asset.format).toBe("jpg");
    expect(asset.bytes).toBeGreaterThan(0);
    const stat = await fs.stat(output);
    expect(stat.size).toBe(asset.bytes);
  });

  it("downscales for vision within the max edge bound", async () => {
    const root = await tempRoot();
    const input = path.join(root, "input.jpg");
    await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "green" } })
      .jpeg()
      .toFile(input);

    const processor = new SharpProcessor();
    const buffer = await processor.downscaleForVision(input, 512);
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBeLessThanOrEqual(512);
    expect(meta.height).toBeLessThanOrEqual(512);
  });

  it("refuses to silently overwrite an existing output target (atomic link)", async () => {
    const root = await tempRoot();
    const input = path.join(root, "input.jpg");
    const output = path.join(root, "out", "existing.jpg");
    await sharp({ create: { width: 200, height: 100, channels: 3, background: "red" } })
      .jpeg()
      .toFile(input);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, "pre-existing caller file", "utf8");

    const processor = new SharpProcessor();
    const plan = planResize({ width: 200, height: 100 }, { format: "jpg", maxWidth: 100 });
    if (!plan.ok) {
      expect.fail("plan should be satisfiable");
    }
    await expect(processor.produce(input, output, plan)).rejects.toBeInstanceOf(WriteError);
    // The pre-existing target is untouched.
    await expect(fs.readFile(output, "utf8")).resolves.toBe("pre-existing caller file");
    // No leftover temp file pollutes the output directory.
    const entries = await fs.readdir(path.dirname(output));
    expect(entries).toEqual(["existing.jpg"]);
  });

  it("leaves no temp file when produce fails to overwrite an existing target", async () => {
    const root = await tempRoot();
    const input = path.join(root, "input.jpg");
    const output = path.join(root, "out", "existing.jpg");
    await sharp({ create: { width: 200, height: 100, channels: 3, background: "red" } })
      .jpeg()
      .toFile(input);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, "pre-existing", "utf8");

    const processor = new SharpProcessor();
    const plan = planResize({ width: 200, height: 100 }, { format: "jpg", maxWidth: 100 });
    if (!plan.ok) {
      expect.fail("plan should be satisfiable");
    }
    await expect(processor.produce(input, output, plan)).rejects.toBeInstanceOf(WriteError);
    const entries = await fs.readdir(path.dirname(output));
    expect(entries).toEqual(["existing.jpg"]);
  });

  it("surfaces a DecodeError (not WriteError) when input is corrupt during produce", async () => {
    const root = await tempRoot();
    const input = path.join(root, "corrupt.jpg");
    const output = path.join(root, "out", "result.jpg");
    await fs.writeFile(input, Buffer.from("corrupt image bytes"), "utf8");

    const processor = new SharpProcessor();
    const plan = planResize({ width: 200, height: 100 }, { format: "jpg", maxWidth: 100 });
    if (!plan.ok) {
      expect.fail("plan should be satisfiable");
    }
    await expect(processor.produce(input, output, plan)).rejects.toBeInstanceOf(DecodeError);
  });

  it("rejects an output path that escapes the configured root via guard", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const input = path.join(root, "input.jpg");
    await sharp({ create: { width: 200, height: 100, channels: 3, background: "red" } })
      .jpeg()
      .toFile(input);
    const escapeOutput = path.join(outside, "escaped.jpg");

    const guard = new StorageRootGuard(root);
    const processor = new SharpProcessor(guard);
    const plan = planResize({ width: 200, height: 100 }, { format: "jpg", maxWidth: 100 });
    if (!plan.ok) {
      expect.fail("plan should be satisfiable");
    }
    await expect(processor.produce(input, escapeOutput, plan)).rejects.toBeInstanceOf(
      StorageRootGuardError
    );
    // Nothing was written outside root.
    await expect(fs.stat(escapeOutput)).rejects.toThrow();
  });

  it("rejects a pre-existing output symlink that escapes the configured root", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const input = path.join(root, "input.jpg");
    await sharp({ create: { width: 200, height: 100, channels: 3, background: "red" } })
      .jpeg()
      .toFile(input);
    const outsideTarget = path.join(outside, "redirected.jpg");
    await fs.writeFile(outsideTarget, "outside", "utf8");
    const outputDir = path.join(root, "out");
    await fs.mkdir(outputDir, { recursive: true });
    const output = path.join(outputDir, "escape.jpg");
    try {
      await fs.symlink(outsideTarget, output, "file");
    } catch (error) {
      if (isPermError(error)) {
        // Windows non-admin cannot create file symlinks; guard's symlink
        // rejection is already covered by the guard's own tests.
        return;
      }
      throw error;
    }

    const guard = new StorageRootGuard(root);
    const processor = new SharpProcessor(guard);
    const plan = planResize({ width: 200, height: 100 }, { format: "jpg", maxWidth: 100 });
    if (!plan.ok) {
      expect.fail("plan should be satisfiable");
    }
    await expect(processor.produce(input, output, plan)).rejects.toBeInstanceOf(
      StorageRootGuardError
    );
    // The outside target was not overwritten.
    await expect(fs.readFile(outsideTarget, "utf8")).resolves.toBe("outside");
  });
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-sharp-"));
  roots.push(root);
  return root;
}

function isPermError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "EPERM"
  );
}