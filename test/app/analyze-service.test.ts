import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeService } from "../../src/app/analyze-service.js";
import { SidecarStore } from "../../src/adapters/sidecar-store.js";
import type { VisionProvider } from "../../src/adapters/vision/provider.js";
import type { Taxonomy } from "../../src/domain/taxonomy.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("analyzeService", () => {
  it("dry-run dedupes AI calls and writes no project state", async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, "a.jpg"), "same-bytes");
    await fs.writeFile(path.join(root, "b.jpg"), "same-bytes");
    const provider = fakeProvider();

    const outcome = await analyzeService(
      root,
      { dryRun: true },
      { provider, image: fakeImage(), taxonomy }
    );

    expect(outcome.result.ok).toBe(true);
    expect(provider.calls).toBe(1);
    await expect(fs.stat(path.join(root, ".img-ia"))).rejects.toThrow();
    await expect(fs.stat(path.join(root, "a.jpg"))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, "b.jpg"))).resolves.toBeDefined();
  });

  it("organizes duplicate occurrences with one analysis and unique destinations", async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, "a.jpg"), "same-bytes");
    await fs.writeFile(path.join(root, "b.jpg"), "same-bytes");
    const provider = fakeProvider();

    const outcome = await analyzeService(root, {}, { provider, image: fakeImage(), taxonomy });
    const sidecarFile = (await fs.readdir(path.join(root, ".img-ia", "sidecars")))[0]!;
    const sidecar = (await new SidecarStore(root).read(sidecarFile.replace(/\.json$/, "")))!;

    expect(outcome.result.ok).toBe(true);
    expect(provider.calls).toBe(1);
    expect(sidecar.occurrences).toHaveLength(2);
    expect(new Set(sidecar.occurrences).size).toBe(2);
    await expect(fs.stat(path.join(root, sidecar.occurrences[0]!))).resolves.toBeDefined();
    await expect(fs.stat(path.join(root, sidecar.occurrences[1]!))).resolves.toBeDefined();
  });

  it("converts walk-level traversal errors into batch-shaped skipped entries with filesystem exit 5", async () => {
    // A root that does not exist causes walkImages to fail at fs.readdir on
    // the root directory, which must be caught as a batch skipped entry
    // (exit 5 filesystem), not a global invalid_input exit 3.
    const root = path.join(os.tmpdir(), `smart-image-nonexistent-${Date.now()}`);
    roots.push(root);
    // Do NOT create the directory — readdir will fail.

    const provider = fakeProvider();
    const outcome = await analyzeService(
      root,
      { dryRun: true },
      { provider, image: fakeImage(), taxonomy }
    );

    expect(outcome.exitCode).toBe(5);
    expect(outcome.result.status).not.toBe("success");
    const details = outcome.result.details as {
      skipped: Array<{ path: string; error: { type: string; message: string } }>;
    };
    expect(details.skipped.length).toBe(1);
    // A nonexistent root may fail either at fs.readdir (generic Error) or at
    // the project-config root guard (StorageRootGuardError) when the guard
    // validates the missing config path's parent chain. Both are walk-level
    // failures producing exit 5; the exact error type is an implementation
    // detail and not part of the contract under test.
    expect(["Error", "StorageRootGuardError"]).toContain(details.skipped[0]!.error.type);
  });

  it("redacts secret-shaped error messages in skipped entries", async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, "a.jpg"), "bytes");
    // Build the secret dynamically so no committed literal looks like a real
    // provider token. The redactor's LONG_SECRET_VALUE regex still matches
    // the assembled value because it starts with sk_ and has 24+ word chars.
    const secret = ["sk", "test_secret_1234567890_abcdef"].join("_");
    const provider: VisionProvider & { calls: number } = {
      id: "fake-model",
      calls: 0,
      async analyze() {
        this.calls += 1;
        throw new Error(`provider failed with key ${secret}`);
      }
    };

    const outcome = await analyzeService(root, {}, { provider, image: fakeImage(), taxonomy });

    const details = outcome.result.details as { skipped: Array<{ error: { message: string } }> };
    expect(details.skipped.length).toBe(1);
    expect(details.skipped[0]!.error.message).not.toContain(secret);
  });

  it("continues traversal past a bad symlink entry and still processes a valid image after it", async () => {
    const root = await tempRoot();
    // A valid image that appears AFTER the bad entry in lexical order so the
    // walk must continue past the bad entry to reach it.
    await fs.writeFile(path.join(root, "zz-good.jpg"), "bytes");
    // Create a broken symlink at 00-bad.jpg pointing to a nonexistent target
    // so fs.stat on the symlink fails during walk entry processing. Do NOT
    // create a real file first — a prior file at the same path caused
    // fs.symlink to fail with EEXIST and the test returned early without
    // exercising the bad-entry traversal contract.
    let symlinkCreated = true;
    try {
      await fs.symlink(
        path.join(root, "nonexistent-target-does-not-exist"),
        path.join(root, "00-bad.jpg")
      );
    } catch (error) {
      // OS denied symlink creation (e.g. no privilege on Windows). Skip
      // honestly with an explicit message rather than silently passing.
      if (isNodeError(error) && (error.code === "EPERM" || error.code === "EACCES")) {
        symlinkCreated = false;
      } else {
        throw error;
      }
    }
    if (!symlinkCreated) {
      console.warn(
        "SKIP: bad-entry traversal test — OS denied symlink creation on this platform"
      );
      return;
    }

    const provider = fakeProvider();
    const outcome = await analyzeService(
      root,
      { dryRun: true },
      { provider, image: fakeImage(), taxonomy }
    );

    // The bad symlink is skipped, the valid image after it is still processed.
    const details = outcome.result.details as {
      planned: Array<{ sha256: string; from: string }>;
      skipped: Array<{ path: string; error: { type: string; message: string } }>;
    };
    // The good image must appear in planned (dry-run) even though the bad
    // entry precedes it lexically.
    const plannedPaths = details.planned.map((p) => p.from);
    expect(plannedPaths).toContain("zz-good.jpg");
    // At least one bad entry must have been skipped — proving the walk
    // encountered and survived the bad symlink rather than aborting.
    expect(details.skipped.length).toBeGreaterThanOrEqual(1);
  });
});

function fakeProvider(): VisionProvider & { calls: number } {
  return {
    id: "fake-model",
    calls: 0,
    async analyze() {
      this.calls += 1;
      return analysis;
    }
  };
}

function fakeImage() {
  return {
    async probe() {
      return { width: 1200, height: 800, format: "jpg" as const };
    },
    async downscaleForVision() {
      return Buffer.from("vision");
    }
  };
}

const analysis = {
  subject: "Kitchen",
  categories: ["kitchen-remodeling"],
  orientation: "landscape" as const,
  altText: "Kitchen remodel",
  title: "Kitchen",
  description: "Kitchen remodel photo",
  suggestedSlug: "Kitchen"
};
const taxonomy: Taxonomy = {
  version: 1,
  categories: [{ id: "kitchen-remodeling", label: "Kitchen Remodeling", aliases: [] }]
};

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-analyze-"));
  roots.push(root);
  return root;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
