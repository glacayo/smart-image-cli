import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  StorageRootGuard,
  StorageRootGuardError,
  assertOccurrenceInsideRoot,
  fsyncDirectoryHonest,
  __setDirectoryFsyncForTest
} from "../../src/adapters/storage-root-guard.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("StorageRootGuard", () => {
  it("allows paths inside the root", async () => {
    const root = await tempRoot();
    const guard = new StorageRootGuard(root);
    const inside = path.join(root, ".img-ia", "sidecars", "abc.json");
    await expect(guard.ensureParentInside(inside)).resolves.toBe(inside);
  });

  it("rejects a pre-existing .img-ia symlink that points outside root", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const imgIa = path.join(root, ".img-ia");
    const outsideTarget = path.join(outside, "escaped-state");
    await fs.mkdir(outsideTarget, { recursive: true });

    // Create a symlink: root/.img-ia -> outside/escaped-state
    await fs.symlink(outsideTarget, imgIa, process.platform === "win32" ? "junction" : "dir");

    const guard = new StorageRootGuard(root);
    const sidecarPath = path.join(imgIa, "sidecars", "abc.json");
    await expect(guard.ensureParentInside(sidecarPath)).rejects.toBeInstanceOf(
      StorageRootGuardError
    );
  });

  it("rejects a pre-existing sidecar symlink pointing outside root on read", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const sidecarDir = path.join(root, ".img-ia", "sidecars");
    await fs.mkdir(sidecarDir, { recursive: true });
    const outsideFile = path.join(outside, "stolen.json");
    await fs.writeFile(outsideFile, "stolen", "utf8");

    const linkPath = path.join(sidecarDir, "abc.json");
    try {
      await fs.symlink(outsideFile, linkPath, "file");
    } catch (error) {
      // Windows non-admin cannot create file symlinks (EPERM). Skip this test
      // on such environments — the junction-based tests cover the same guard.
      if (isPermError(error)) {
        return;
      }
      throw error;
    }

    const guard = new StorageRootGuard(root);
    await expect(guard.ensureInside(linkPath, true)).rejects.toBeInstanceOf(
      StorageRootGuardError
    );
  });

  it("ensureInsideSync rejects a DB path under a junction escaping root", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const outsideTarget = path.join(outside, "escaped-db");
    await fs.mkdir(outsideTarget, { recursive: true });
    await fs.symlink(
      outsideTarget,
      path.join(root, ".img-ia"),
      process.platform === "win32" ? "junction" : "dir"
    );

    const guard = new StorageRootGuard(root);
    expect(() =>
      guard.ensureInsideSync(path.join(root, ".img-ia", "index.sqlite"))
    ).toThrow(StorageRootGuardError);
  });
});

describe("assertOccurrenceInsideRoot", () => {
  it("accepts a normal relative path", () => {
    expect(assertOccurrenceInsideRoot("organized/kitchen-001.jpg")).toBe(
      "organized/kitchen-001.jpg"
    );
  });

  it("rejects an absolute path", () => {
    expect(() => assertOccurrenceInsideRoot("/etc/passwd")).toThrow(StorageRootGuardError);
    if (process.platform === "win32") {
      expect(() => assertOccurrenceInsideRoot("C:\\Windows\\system32")).toThrow(
        StorageRootGuardError
      );
    }
  });

  it("rejects a parent-traversal path", () => {
    expect(() => assertOccurrenceInsideRoot("../outside/secret.txt")).toThrow(
      StorageRootGuardError
    );
    expect(() => assertOccurrenceInsideRoot("organized/../../escape.jpg")).toThrow(
      StorageRootGuardError
    );
  });

  it("rejects a Windows drive-relative path", () => {
    expect(() => assertOccurrenceInsideRoot("C:foo")).toThrow(StorageRootGuardError);
  });

  it("rejects an empty path", () => {
    expect(() => assertOccurrenceInsideRoot("")).toThrow(StorageRootGuardError);
  });
});

describe("fsyncDirectoryHonest", () => {
  afterEach(() => {
    // Always restore the real directory-fsync impl between tests so the seam
    // does not leak into other tests in the same file/run.
    __setDirectoryFsyncForTest(undefined);
  });

  it("does not throw on platforms where directory fsync is unsupported (degraded branch)", async () => {
    const root = await tempRoot();
    // On Windows, fsync on a directory handle returns EINVAL/EPERM and the
    // function must surface it as a `unsupported: true` result rather than
    // throwing. On POSIX this directory fsync usually succeeds; either way the
    // call must not throw and must return an honest result descriptor.
    const result = await fsyncDirectoryHonest(root);
    expect(result.platform).toBe(process.platform);
    if (process.platform === "win32") {
      // Windows cannot fsync directories — the degraded branch must report
      // unsupported, not throw.
      expect(result.synced).toBe(false);
      expect(result.unsupported).toBe(true);
    } else {
      // POSIX supports directory fsync; expect a real synced result.
      expect(result.synced).toBe(true);
      expect(result.unsupported).toBe(false);
    }
  });

  it("surfaces a genuine fsync failure as a thrown error (not degraded)", async () => {
    // Inject a failing directory-fsync via the test seam: sync() rejects with
    // EIO (a genuine I/O failure, not an "unsupported" code). This proves a
    // real fsync failure propagates instead of being silently swallowed as
    // "degraded durability".
    const root = await tempRoot();
    __setDirectoryFsyncForTest(async () => {
      const err = new Error("genuine fsync failure") as NodeJS.ErrnoException;
      err.code = "EIO";
      throw err;
    });

    await expect(fsyncDirectoryHonest(root)).rejects.toThrow(/genuine fsync failure/);
  });
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-guard-"));
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