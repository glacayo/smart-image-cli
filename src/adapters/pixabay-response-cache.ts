import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { StorageRootGuard } from "./storage-root-guard.js";

/** Pixabay search responses are reusable for 24 hours per project. */
export const PIXABAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type PixabayCacheReadResult<T = unknown> =
  { status: "hit"; value: T } | { status: "miss" } | { status: "stale" };

export type PixabayResponseCacheOptions = {
  root: string;
  /** Injectable clock (epoch ms). Defaults to `Date.now`. */
  now?: () => number;
  ttlMs?: number;
};

type CacheFile = {
  cachedAt: number;
  identity: string;
  payload: unknown;
};

/**
 * Per-project Pixabay search response cache.
 *
 * Identity is the request URL with `key` removed and query params sorted.
 * Files live under `.img-ia/pixabay/cache/<sha256(identity)>.json` at mode 0600.
 * Read/write failures never throw — callers fall back to a live request.
 */
export class PixabayResponseCache {
  private readonly guard: StorageRootGuard;
  private readonly cacheDir: string;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: PixabayResponseCacheOptions) {
    this.guard = new StorageRootGuard(options.root);
    this.cacheDir = path.join(options.root, ".img-ia", "pixabay", "cache");
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? PIXABAY_CACHE_TTL_MS;
  }

  /** Absolute path for a canonical identity (hash filename — never the raw key). */
  pathFor(identity: string): string {
    return path.join(this.cacheDir, `${hashIdentity(identity)}.json`);
  }

  async read<T = unknown>(identity: string): Promise<PixabayCacheReadResult<T>> {
    const target = this.pathFor(identity);
    try {
      await this.guard.ensureInside(target, true);
      const raw = await fs.readFile(target, "utf8");
      if (containsKeyMaterial(raw)) {
        return { status: "miss" };
      }
      const parsed: unknown = JSON.parse(raw);
      if (!isCacheFile(parsed) || parsed.identity !== identity) {
        return { status: "miss" };
      }
      const age = this.now() - parsed.cachedAt;
      if (age < 0) {
        return { status: "miss" };
      }
      if (age > this.ttlMs) {
        return { status: "stale" };
      }
      return { status: "hit", value: parsed.payload as T };
    } catch {
      return { status: "miss" };
    }
  }

  /**
   * Atomically persist a payload for `identity`.
   * Returns `true` on success, `false` on any failure or key-material rejection.
   */
  async write(identity: string, payload: unknown): Promise<boolean> {
    if (containsKeyMaterial(identity) || containsKeyMaterial(JSON.stringify(payload))) {
      return false;
    }
    const target = this.pathFor(identity);
    const entry: CacheFile = {
      cachedAt: this.now(),
      identity,
      payload
    };
    const body = `${JSON.stringify(entry)}\n`;
    if (containsKeyMaterial(body)) {
      return false;
    }

    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    let handle: fs.FileHandle | undefined;
    try {
      await this.guard.ensureParentInside(target);
      handle = await fs.open(
        temp,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600
      );
      await handle.writeFile(body, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temp, target);
      // Best-effort final mode (some platforms ignore mode on open).
      await fs.chmod(target, 0o600).catch(() => undefined);
      return true;
    } catch {
      if (handle !== undefined) {
        await handle.close().catch(() => undefined);
      }
      await fs.rm(temp, { force: true }).catch(() => undefined);
      return false;
    }
  }
}

/**
 * Build a stable, key-free cache identity from a Pixabay request URL.
 * Drops every `key` query param and sorts remaining params by name then value.
 */
export function canonicalKey(input: string | URL): string {
  const url = new URL(typeof input === "string" ? input : input.href);
  const pairs: Array<[string, string]> = [];
  for (const [name, value] of url.searchParams.entries()) {
    if (name.toLowerCase() === "key") continue;
    pairs.push([name, value]);
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const query = pairs
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
  const base = `${url.origin}${url.pathname}`;
  return query.length > 0 ? `${base}?${query}` : base;
}

function hashIdentity(identity: string): string {
  return createHash("sha256").update(identity).digest("hex");
}

function isCacheFile(value: unknown): value is CacheFile {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.cachedAt === "number" &&
    Number.isFinite(record.cachedAt) &&
    typeof record.identity === "string" &&
    record.identity.length > 0 &&
    "payload" in record
  );
}

/** Detect API-key material that must never touch cache identity, body, or disk. */
function containsKeyMaterial(text: string): boolean {
  if (/[?&]key=/i.test(text)) return true;
  if (/(?:^|[?&#])key=[^&\s"']+/i.test(text)) return true;
  if (/"key"\s*:\s*"[^"]+"/i.test(text)) return true;
  return false;
}
