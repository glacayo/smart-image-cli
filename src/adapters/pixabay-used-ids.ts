import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { StorageRootGuard, fsyncDirectoryHonest } from "./storage-root-guard.js";

const SHA256_RE = /^[a-f0-9]{64}$/i;

export type PixabayUsedIdRecord = {
  id: number;
  sha256: string;
};

export type PixabayUsedIdsOptions = {
  root: string;
};

/** FileHandle.write-compatible seam for short-write-safe full buffer writes. */
export type ByteWriter = (
  buffer: Buffer,
  offset?: number,
  length?: number
) => Promise<{ bytesWritten: number }>;

/** Advance by bytesWritten until complete; reject non-positive/invalid progress. */
export async function writeAllBytes(write: ByteWriter, buffer: Buffer): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const remaining = buffer.length - offset;
    const { bytesWritten } = await write(buffer, offset, remaining);
    if (!Number.isInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > remaining) {
      throw new PixabayUsedIdsError(
        `Write made no durable progress at offset ${offset} (bytesWritten=${String(bytesWritten)})`
      );
    }
    offset += bytesWritten;
  }
}

/**
 * Append-only Pixabay id→sha index at `.img-ia/pixabay/used-ids.jsonl`.
 *
 * This is an index, not truth: pick later intersects mapped SHAs with
 * `usage.jsonl` for the slot+location. Torn/malformed lines are skipped on read.
 */
export class PixabayUsedIds {
  private readonly guard: StorageRootGuard;
  readonly path: string;

  constructor(options: PixabayUsedIdsOptions) {
    this.guard = new StorageRootGuard(options.root);
    this.path = path.join(options.root, ".img-ia", "pixabay", "used-ids.jsonl");
  }

  /** Latest sha per numeric id. Missing file or unreadable content → empty map. */
  async readMap(): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    let raw: string;
    try {
      await this.guard.ensureInside(this.path, true);
      raw = await fs.readFile(this.path, "utf8");
    } catch {
      return map;
    }

    for (const line of raw.split("\n")) {
      const entry = parseUsedIdLine(line);
      if (entry !== null) {
        map.set(entry.id, entry.sha256);
      }
    }
    return map;
  }

  /**
   * Durably append one id→sha mapping (mode 0600).
   * Rejects invalid id/sha before touching the filesystem.
   * Heals a torn final line (no trailing newline) so the new record is not glued.
   */
  async append(id: number, sha256: string): Promise<void> {
    assertUsedId(id);
    assertSha256(sha256);

    const record = `${JSON.stringify({ id, sha256: sha256.toLowerCase() })}\n`;
    let handle: fs.FileHandle | undefined;
    try {
      await this.guard.ensureParentInside(this.path);
      const prefix = await newlinePrefixIfTorn(this.path);
      const payload = Buffer.from(`${prefix}${record}`, "utf8");
      handle = await fs.open(
        this.path,
        constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY,
        0o600
      );
      await writeAllBytes((buf, offset, length) => handle!.write(buf, offset, length), payload);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.chmod(this.path, 0o600).catch(() => undefined);
      const dirSync = await fsyncDirectoryHonest(path.dirname(this.path));
      if (!dirSync.synced && !dirSync.unsupported) {
        throw new PixabayUsedIdsError(
          `Directory fsync failed for ${path.dirname(this.path)} (platform=${dirSync.platform})`
        );
      }
    } catch (error) {
      if (handle !== undefined) {
        await handle.close().catch(() => undefined);
      }
      throw error;
    }
  }
}

/** If the journal ends mid-line, insert a newline so the next JSONL row stays atomic. */
async function newlinePrefixIfTorn(filePath: string): Promise<string> {
  let reader: fs.FileHandle | undefined;
  try {
    reader = await fs.open(filePath, constants.O_RDONLY);
    const stat = await reader.stat();
    if (stat.size === 0) return "";
    const buf = Buffer.alloc(1);
    const { bytesRead } = await reader.read(buf, 0, 1, stat.size - 1);
    if (bytesRead === 1 && buf[0] !== 0x0a /* \n */) {
      return "\n";
    }
    return "";
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw error;
  } finally {
    await reader?.close().catch(() => undefined);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class PixabayUsedIdsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PixabayUsedIdsError";
  }
}

function parseUsedIdLine(line: string): PixabayUsedIdRecord | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (!isPositiveIntId(record.id) || !isSha256(record.sha256)) return null;
    return { id: record.id, sha256: record.sha256.toLowerCase() };
  } catch {
    return null;
  }
}

function assertUsedId(id: number): void {
  if (!isPositiveIntId(id)) {
    throw new PixabayUsedIdsError(`Invalid Pixabay id: ${String(id)}`);
  }
}

function assertSha256(value: string): void {
  if (!isSha256(value)) {
    throw new PixabayUsedIdsError(`Invalid sha256: ${String(value)}`);
  }
}

function isPositiveIntId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}
