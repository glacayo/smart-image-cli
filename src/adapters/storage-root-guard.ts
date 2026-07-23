import { constants } from "node:fs";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

/**
 * Confines adapter-generated state (.img-ia, sidecars, SQLite DB, journals,
 * caches, temp files) to the configured project `--root`.
 *
 * Design refs (design.md "Path safety" / "Symlinks / junctions / reparse"):
 * - `lstat` first; if the path (or any ancestor) is a symlink/junction/reparse
 *   point, resolve its real target via `realpath` and reject if that real path
 *   escapes `--root`.
 * - Never follow a link whose target is outside `--root`.
 * - Used before every write/open of generated state so a pre-existing
 *   `.img-ia` symlink/junction cannot silently redirect durable state outside
 *   the project.
 *
 * NOTE: `node:fs/promises.lstat` follows POSIX semantics on Windows; junctions
 * and reparse points are surfaced as symlinks by libuv on win32, so the same
 * lstat + realpath + containment check covers both POSIX symlinks and Windows
 * junctions/reparse points.
 */
export class StorageRootGuardError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageRootGuardError";
  }
}

export class StorageRootGuard {
  private readonly resolvedRoot: string;
  private readonly normalizedRoot: string;

  constructor(readonly root: string) {
    this.resolvedRoot = path.resolve(root);
    this.normalizedRoot = normalizeForComparison(this.resolvedRoot);
  }

  get resolved(): string {
    return this.resolvedRoot;
  }

  /**
   * Synchronous variant of {@link ensureInside} for constructors that must not
   * be async (e.g. `SqliteIndex` opens better-sqlite3 synchronously). Validates
   * the nearest existing ancestor chain of the candidate path is root-confined
   * and not a symlink/junction/reparse point whose target escapes `--root`.
   */
  ensureInsideSync(candidate: string): void {
    const absolute = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(this.resolvedRoot, candidate);
    const realAncestor = this.realpathOfNearestExistingAncestorSync(absolute);
    this.assertContained(realAncestor, candidate);
  }

  /**
   * Validates that `candidate` (an absolute path or a root-relative path) stays
   * inside the project root after realpath resolution, and that it is not a
   * symlink/junction/reparse point whose target escapes the root.
   *
   * Returns the absolute, root-confined path. Throws `StorageRootGuardError`
   * if the path escapes the root or if a symlink/junction/reparse point points
   * outside the root.
   *
   * @param mustExist When true (default for existing paths), lstat the path and,
   *   if it exists, verify realpath containment. When false (default for paths
   *   about to be created), check the parent chain instead — the path itself
   *   does not exist yet so there is nothing to realpath.
   */
  async ensureInside(candidate: string, mustExist = false): Promise<string> {
    const absolute = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(this.resolvedRoot, candidate);

    if (mustExist) {
      const realpath = await this.realpathInside(absolute);
      this.assertContained(realpath, candidate);
      return realpath;
    }

    // For not-yet-existing paths, verify the nearest existing ancestor chain.
    const realAncestor = await this.realpathOfNearestExistingAncestor(absolute);
    this.assertContained(realAncestor, candidate);
    return absolute;
  }

  /**
   * Ensures the parent directory of `candidate` is root-confined and exists,
   * creating it (recursively) if needed. Returns the absolute path of the
   * candidate. This is the pre-write guard used before creating sidecar/DB/
   * cache files.
   */
  async ensureParentInside(candidate: string): Promise<string> {
    const absolute = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(this.resolvedRoot, candidate);
    const parent = path.dirname(absolute);
    const realParent = await this.realpathOfNearestExistingAncestor(parent);
    this.assertContained(realParent, parent);
    await fs.mkdir(parent, { recursive: true });
    // After mkdir, re-validate the now-existing parent's realpath in case a
    // junction was introduced mid-tree.
    const realParentAfter = await this.realpathInside(parent);
    this.assertContained(realParentAfter, parent);
    return absolute;
  }

  private assertContained(realpath: string, original: string): void {
    if (!isInsideOrSame(realpath, this.resolvedRoot, this.normalizedRoot)) {
      throw new StorageRootGuardError(
        `Generated storage path escapes project root: ${original} -> ${realpath}`,
        { cause: { original, realpath, root: this.resolvedRoot } }
      );
    }
  }

  private async realpathInside(absolute: string): Promise<string> {
    let stat;
    try {
      stat = await fs.lstat(absolute);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        // Does not exist — caller decides; treat as "no reparse to follow".
        return absolute;
      }
      throw error;
    }

    if (!stat.isSymbolicLink()) {
      // Regular file/dir (or a reparse point that libuv does not classify as a
      // symlink — realpath is still safe to call to canonicalize).
      return fs.realpath(absolute).catch(() => absolute);
    }

    // It is a symlink/junction/reparse point — resolve and verify.
    const target = await fs.realpath(absolute);
    return target;
  }

  private async realpathOfNearestExistingAncestor(absolute: string): Promise<string> {
    let current = absolute;
    const visited = new Set<string>();
    for (;;) {
      if (visited.has(current)) {
        // Defensive loop break; should not happen on a sane filesystem.
        throw new StorageRootGuardError(`Path resolution loop detected at ${current}`);
      }
      visited.add(current);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) {
          const target = await fs.realpath(current);
          // Keep the realpath of the ancestor; the descendant (which may not
          // exist yet) is below it and therefore confined.
          return target;
        }
        return fs.realpath(current).catch(() => current);
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
          throw error;
        }
      }
      const parent = path.dirname(current);
      if (parent === current) {
        // Reached the filesystem root without finding an existing ancestor.
        return current;
      }
      current = parent;
    }
  }

  private realpathOfNearestExistingAncestorSync(absolute: string): string {
    let current = absolute;
    const visited = new Set<string>();
    for (;;) {
      if (visited.has(current)) {
        throw new StorageRootGuardError(`Path resolution loop detected at ${current}`);
      }
      visited.add(current);
      try {
        const stat = fsSync.lstatSync(current);
        if (stat.isSymbolicLink()) {
          try {
            return fsSync.realpathSync(current);
          } catch {
            return current;
          }
        }
        try {
          return fsSync.realpathSync(current);
        } catch {
          return current;
        }
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") {
          throw error;
        }
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return current;
      }
      current = parent;
    }
  }
}

/**
 * Validates that a sidecar-controlled occurrence relative path is a
 * root-relative path that cannot escape `--root` during rebuild. Used by
 * `SqliteIndex.rebuildFromSidecars` before joining/hashing occurrence paths.
 *
 * Rejects:
 * - absolute paths (`/etc/passwd`, `C:\Windows`)
 * - Windows drive-relative prefixes (`C:foo`)
 * - `..` traversal segments that resolve outside the root
 */
export function assertOccurrenceInsideRoot(relPath: string): string {
  if (relPath.length === 0) {
    throw new StorageRootGuardError("Occurrence path must not be empty");
  }
  if (path.isAbsolute(relPath)) {
    throw new StorageRootGuardError(`Occurrence path is absolute: ${relPath}`);
  }
  if (/^[a-zA-Z]:/.test(relPath)) {
    throw new StorageRootGuardError(`Occurrence path is drive-relative: ${relPath}`);
  }
  const normalized = path.posix.normalize(relPath.replace(/\\/g, "/"));
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw new StorageRootGuardError(`Occurrence path escapes root via '..': ${relPath}`);
    }
  }
  return normalized;
}

/**
 * Platform-aware, honest directory fsync.
 *
 * On Windows, `fsync` on a directory handle is not supported by the OS
 * (returns EINVAL/EPERM). We attempt it and swallow the known unsupported
 * errors, returning a status that callers can surface honestly. This does NOT
 * silently claim full durability on Windows — file fsync + atomic rename is
 * best-effort there for directory-entry durability.
 *
 * On POSIX, directory fsync is supported and attempted for real.
 */
export type DirectoryFsyncResult = {
  synced: boolean;
  unsupported: boolean;
  platform: typeof process.platform;
};

/**
 * Test seam for {@link fsyncDirectoryHonest}: the directory-fsync operation.
 * Defaults to the real `handle.sync()`. Tests inject a failing impl to prove a
 * genuine fsync error (e.g. EIO) propagates instead of being silently swallowed
 * as "degraded durability". This is intentionally a module-level seam (not a
 * constructor option) so production code is unaffected.
 */
export type DirectoryFsyncFn = (handle: FileHandle) => Promise<void>;

let directoryFsyncFn: DirectoryFsyncFn = (handle) => handle.sync();

/**
 * @internal Test-only seam. Replaces the directory-fsync implementation used by
 * {@link fsyncDirectoryHonest}. Pass `undefined` to restore the real impl.
 */
export function __setDirectoryFsyncForTest(fn?: DirectoryFsyncFn): void {
  directoryFsyncFn = fn ?? ((handle) => handle.sync());
}

export async function fsyncDirectoryHonest(directory: string): Promise<DirectoryFsyncResult> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(directory, constants.O_RDONLY);
    await directoryFsyncFn(handle);
    return { synced: true, unsupported: false, platform: process.platform };
  } catch (error) {
    if (isNodeError(error) && ["EINVAL", "EPERM", "EISDIR", "ENOTSUP"].includes(error.code ?? "")) {
      return { synced: false, unsupported: true, platform: process.platform };
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function isInsideOrSame(candidate: string, root: string, normalizedRoot: string): boolean {
  const normalizedCandidate = normalizeForComparison(path.resolve(candidate));
  const rel = path.relative(normalizedRoot, normalizedCandidate);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../") && !path.isAbsolute(rel))
  );
}

function normalizeForComparison(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
