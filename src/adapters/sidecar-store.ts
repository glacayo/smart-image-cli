import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ImageAnalysis } from "../domain/analysis-schema.js";
import {
  StorageRootGuard,
  StorageRootGuardError,
  fsyncDirectoryHonest
} from "./storage-root-guard.js";

export type SidecarDimensions = {
  width: number;
  height: number;
};

export type SidecarPrimaryFlag = "canonicalRelPath";

export type Sidecar = {
  sha256: string;
  classification: ImageAnalysis;
  dims: SidecarDimensions;
  originalName: string;
  model: string;
  canonicalRelPath: string;
  occurrences: string[];
  primaryFlag: SidecarPrimaryFlag;
};

export type SidecarSeed = Omit<
  Sidecar,
  "sha256" | "occurrences" | "canonicalRelPath" | "primaryFlag"
> & {
  canonicalRelPath?: string;
  occurrences?: readonly string[];
};

export class SidecarStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SidecarStoreError";
  }
}

export class SidecarValidationError extends SidecarStoreError {
  constructor(message: string) {
    super(message);
    this.name = "SidecarValidationError";
  }
}

export class SidecarStore {
  readonly sidecarDir: string;
  private readonly locks = new Map<string, Promise<void>>();
  private readonly guard: StorageRootGuard;

  constructor(readonly root: string) {
    this.guard = new StorageRootGuard(root);
    this.sidecarDir = path.join(root, ".img-ia", "sidecars");
  }

  async read(sha256: string): Promise<Sidecar | null> {
    const sidecarPath = this.pathForSha(sha256);

    try {
      await this.guard.ensureInside(sidecarPath, true);
      const raw = await fs.readFile(sidecarPath, "utf8");
      return normalizeSidecarPrimary(JSON.parse(raw) as Sidecar);
    } catch (error) {
      if (isStorageRootGuardError(error)) {
        throw error;
      }
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw new SidecarStoreError(`Failed to read sidecar for ${sha256}`, { cause: error });
    }
  }

  async write(sha256: string, sidecar: Sidecar): Promise<Sidecar> {
    return this.withShaLock(sha256, async () => {
      const normalized = normalizeSidecarPrimary({ ...sidecar, sha256 });
      await this.writeUnlocked(sha256, normalized);
      return normalized;
    });
  }

  async mergeOccurrence(sha256: string, relPath: string, seed?: SidecarSeed): Promise<Sidecar> {
    return this.withShaLock(sha256, async () => {
      const current = await this.readUnlocked(sha256);
      if (current === null && seed === undefined) {
        throw new SidecarValidationError(
          `Cannot create first sidecar for ${sha256} without classification seed data`
        );
      }

      const base = current ?? sidecarFromSeed(sha256, relPath, seed!);
      const occurrences = appendUnique(base.occurrences, relPath);
      const normalized = normalizeSidecarPrimary({
        ...base,
        canonicalRelPath: base.canonicalRelPath || relPath,
        occurrences
      });

      if (current !== null && arraysEqual(current.occurrences, normalized.occurrences)) {
        return normalized;
      }

      await this.writeUnlocked(sha256, normalized);
      return normalized;
    });
  }

  pathForSha(sha256: string): string {
    assertSha256(sha256);
    return path.join(this.sidecarDir, `${sha256}.json`);
  }

  /**
   * Validates the sidecar directory path (and its ancestor chain) stays
   * inside the project root, including symlink/junction/reparse-point
   * realpath semantics. Throws `StorageRootGuardError` if the sidecar
   * directory escapes the root.
   *
   * Callers that enumerate the sidecar directory (e.g. `listSidecars`)
   * MUST invoke this before `fs.readdir` so a pre-existing `.img-ia/sidecars`
   * symlink/junction cannot redirect outside-root enumeration before
   * per-sidecar guarded reads reject.
   *
   * Returns the realpath-resolved, root-confined sidecar directory path.
   */
  async ensureSidecarDirInside(): Promise<string> {
    return this.guard.ensureInside(this.sidecarDir, true);
  }

  private async readUnlocked(sha256: string): Promise<Sidecar | null> {
    const sidecarPath = this.pathForSha(sha256);
    try {
      await this.guard.ensureInside(sidecarPath, true);
      const raw = await fs.readFile(sidecarPath, "utf8");
      return normalizeSidecarPrimary(JSON.parse(raw) as Sidecar);
    } catch (error) {
      if (isStorageRootGuardError(error)) {
        throw error;
      }
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async writeUnlocked(sha256: string, sidecar: Sidecar): Promise<void> {
    const target = this.pathForSha(sha256);
    // Validate the parent (and its ancestors) are root-confined and not a
    // pre-existing symlink/junction that would redirect durable state outside
    // the project. This runs before any mkdir/write so a malicious `.img-ia`
    // reparse point cannot escape the root.
    await this.guard.ensureParentInside(target);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const payload = `${JSON.stringify(sidecar, null, 2)}\n`;

    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(
        temp,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600
      );
      await handle.writeFile(payload, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      // Atomic rename replaces any prior sidecar for this sha. The temp file
      // is exclusive (O_EXCL) so concurrent writers for the same sha cannot
      // collide here; the per-sha lock serializes merges for the same sha.
      await fs.rename(temp, target);
      // Honest directory fsync: on Windows this is unsupported by the OS and
      // we surface that as a non-fatal degraded-durability state rather than
      // silently claiming full durability.
      const dirSync = await fsyncDirectoryHonest(this.sidecarDir);
      if (!dirSync.synced && !dirSync.unsupported) {
        throw new SidecarStoreError(
          `Directory fsync failed for ${this.sidecarDir} (platform=${dirSync.platform})`
        );
      }
    } catch (error) {
      if (handle !== undefined) {
        await handle.close().catch(() => undefined);
      }
      await fs.rm(temp, { force: true }).catch(() => undefined);
      if (isStorageRootGuardError(error)) {
        throw error;
      }
      throw new SidecarStoreError(`Failed to durably write sidecar for ${sha256}`, {
        cause: error
      });
    }
  }

  private async withShaLock<T>(sha256: string, work: () => Promise<T>): Promise<T> {
    assertSha256(sha256);
    const prior = this.locks.get(sha256) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prior.then(
      () => next,
      () => next
    );
    this.locks.set(sha256, chained);

    await prior;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(sha256) === chained) {
        this.locks.delete(sha256);
      }
    }
  }
}

export function normalizeSidecarPrimary(sidecar: Sidecar): Sidecar {
  assertSha256(sidecar.sha256);
  if (sidecar.canonicalRelPath.length === 0) {
    throw new SidecarValidationError("canonicalRelPath must not be empty");
  }

  const occurrences = appendUnique(sidecar.occurrences, sidecar.canonicalRelPath);
  const withoutCanonical = occurrences.filter(
    (occurrence) => occurrence !== sidecar.canonicalRelPath
  );

  return {
    ...sidecar,
    primaryFlag: "canonicalRelPath",
    occurrences: [sidecar.canonicalRelPath, ...withoutCanonical]
  };
}

export function selectPrimaryOccurrence(
  sidecar: Sidecar,
  liveVerifiedOccurrences: readonly string[]
): Sidecar {
  const canonicalStillLive = liveVerifiedOccurrences.includes(sidecar.canonicalRelPath);
  const canonicalRelPath = canonicalStillLive
    ? sidecar.canonicalRelPath
    : (liveVerifiedOccurrences[0] ?? sidecar.canonicalRelPath);

  return normalizeSidecarPrimary({
    ...sidecar,
    canonicalRelPath,
    occurrences: appendManyUnique(sidecar.occurrences, liveVerifiedOccurrences)
  });
}

function isStorageRootGuardError(error: unknown): error is StorageRootGuardError {
  return error instanceof StorageRootGuardError;
}

function sidecarFromSeed(sha256: string, relPath: string, seed: SidecarSeed): Sidecar {
  return normalizeSidecarPrimary({
    ...seed,
    sha256,
    canonicalRelPath: seed.canonicalRelPath ?? relPath,
    occurrences: appendManyUnique(
      [seed.canonicalRelPath ?? relPath],
      seed.occurrences ?? [relPath]
    ),
    primaryFlag: "canonicalRelPath"
  });
}

function appendUnique(values: readonly string[], value: string): string[] {
  return appendManyUnique(values, [value]);
}

function appendManyUnique(values: readonly string[], additions: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...values, ...additions]) {
    if (value.length > 0 && !seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }
  return merged;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new SidecarValidationError(`Invalid sha256: ${value}`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
