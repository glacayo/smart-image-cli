import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SidecarStore,
  SidecarStoreError,
  type SidecarSeed
} from "../../src/adapters/sidecar-store.js";
import { StorageRootGuardError } from "../../src/adapters/storage-root-guard.js";

const roots: string[] = [];
const sha = "a".repeat(64);

const seed: SidecarSeed = {
  classification: {
    subject: "Kitchen",
    categories: ["kitchen-remodeling"],
    orientation: "landscape",
    altText: "Kitchen remodel",
    title: "Kitchen",
    description: "Kitchen remodel photo",
    suggestedSlug: "kitchen"
  },
  dims: { width: 1200, height: 800 },
  originalName: "IMG_001.JPG",
  model: "test-model",
  canonicalRelPath: "kitchen/kitchen-001.jpg"
};

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("SidecarStore", () => {
  it("serializes concurrent occurrence merges under one sha lock", async () => {
    const root = await tempRoot();
    const store = new SidecarStore(root);

    await Promise.all([
      store.mergeOccurrence(sha, "raw/a.jpg", seed),
      store.mergeOccurrence(sha, "raw/b.jpg", seed),
      store.mergeOccurrence(sha, "raw/c.jpg", seed)
    ]);

    const sidecar = await store.read(sha);
    expect(sidecar?.occurrences).toEqual([
      "kitchen/kitchen-001.jpg",
      "raw/a.jpg",
      "raw/b.jpg",
      "raw/c.jpg"
    ]);
    expect(sidecar?.primaryFlag).toBe("canonicalRelPath");
  });

  it("keeps canonicalRelPath as the first occurrence on direct writes", async () => {
    const root = await tempRoot();
    const store = new SidecarStore(root);

    await store.write(sha, {
      ...seed,
      sha256: sha,
      canonicalRelPath: "organized/primary.jpg",
      occurrences: ["raw/copy.jpg"],
      primaryFlag: "canonicalRelPath"
    });

    const sidecar = await store.read(sha);
    expect(sidecar?.occurrences[0]).toBe("organized/primary.jpg");
    expect(sidecar?.occurrences).toContain("raw/copy.jpg");
  });

  it("refuses to write a sidecar when .img-ia is a symlink/junction escaping root", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const outsideTarget = path.join(outside, "escaped-sidecars");
    await fs.mkdir(outsideTarget, { recursive: true });
    await fs.symlink(
      outsideTarget,
      path.join(root, ".img-ia"),
      process.platform === "win32" ? "junction" : "dir"
    );

    const store = new SidecarStore(root);
    await expect(
      store.write(sha, {
        ...seed,
        sha256: sha,
        canonicalRelPath: "kitchen/kitchen-001.jpg",
        occurrences: ["kitchen/kitchen-001.jpg"],
        primaryFlag: "canonicalRelPath"
      })
    ).rejects.toBeInstanceOf(StorageRootGuardError);

    // Nothing should have been written outside the root.
    await expect(fs.readFile(path.join(outsideTarget, "sidecars", `${sha}.json`), "utf8")).rejects
      .toBeDefined();
  });

  it("refuses to read a sidecar that is a symlink pointing outside root", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const sidecarDir = path.join(root, ".img-ia", "sidecars");
    await fs.mkdir(sidecarDir, { recursive: true });
    const outsideFile = path.join(outside, "stolen.json");
    await fs.writeFile(outsideFile, "stolen", "utf8");
    try {
      await fs.symlink(outsideFile, path.join(sidecarDir, `${sha}.json`), "file");
    } catch (error) {
      // Windows non-admin cannot create file symlinks (EPERM). Skip — the
      // junction-based tests cover the same guard for directory escapes.
      if (isPermError(error)) {
        return;
      }
      throw error;
    }

    const store = new SidecarStore(root);
    await expect(store.read(sha)).rejects.toBeInstanceOf(StorageRootGuardError);
  });

  it("does not leak StorageRootGuardError as a generic SidecarStoreError on write", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await fs.mkdir(path.join(outside, "escaped"), { recursive: true });
    await fs.symlink(
      path.join(outside, "escaped"),
      path.join(root, ".img-ia"),
      process.platform === "win32" ? "junction" : "dir"
    );

    const store = new SidecarStore(root);
    try {
      await store.mergeOccurrence(sha, "raw/a.jpg", seed);
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageRootGuardError);
      expect(error).not.toBeInstanceOf(SidecarStoreError);
    }
  });
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-sidecar-"));
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
