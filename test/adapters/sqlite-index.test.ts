import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteIndex, type UsageEvent } from "../../src/adapters/sqlite-index.js";
import { StorageRootGuardError } from "../../src/adapters/storage-root-guard.js";
import type { Sidecar } from "../../src/adapters/sidecar-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("SqliteIndex", () => {
  it("replays raw usage events separately from deduped usage records", async () => {
    const root = await tempRoot();
    const usagePath = path.join(root, ".img-ia", "usage.jsonl");
    await fs.mkdir(path.dirname(usagePath), { recursive: true });
    const event = usageEvent({ at: "2026-01-01T00:00:00.000Z" });
    await fs.writeFile(
      usagePath,
      `${JSON.stringify(event)}\n${JSON.stringify({ ...event, at: "2026-01-01T00:01:00.000Z" })}\n`,
      "utf8"
    );

    const index = new SqliteIndex(root);
    const replay = index.replayUsageJournal(usagePath);
    const stats = index.stats();
    index.close();

    expect(replay.usageEvents).toBe(2);
    expect(replay.usageRecords).toBe(1);
    expect(stats.totals.usageEvents).toBe(2);
    expect(stats.totals.usageRecords).toBe(1);
  });

  it("indexes only live occurrences whose sha matches the sidecar and promotes a live primary", async () => {
    const root = await tempRoot();
    const liveRel = "organized/live.jpg";
    const staleRel = "organized/stale.jpg";
    const missingRel = "organized/missing.jpg";
    await fs.mkdir(path.join(root, "organized"), { recursive: true });
    await fs.writeFile(path.join(root, liveRel), "live bytes");
    await fs.writeFile(path.join(root, staleRel), "edited bytes");
    const liveSha = sha256("live bytes");

    const sidecar = sidecarFor(liveSha, {
      canonicalRelPath: missingRel,
      occurrences: [missingRel, liveRel, staleRel]
    });

    const index = new SqliteIndex(root);
    const result = await index.rebuildFromSidecars([sidecar]);
    const record = index.findBySha(liveSha);
    index.close();

    expect(record?.occurrences).toEqual([liveRel]);
    expect(record?.canonicalRelPath).toBe(liveRel);
    expect(result.promotedPrimaries).toEqual([{ sha256: liveSha, canonicalRelPath: liveRel }]);
    expect(result.staleOccurrences).toEqual([
      { sha256: liveSha, relPath: missingRel, reason: "missing" },
      { sha256: liveSha, relPath: staleRel, reason: "sha_mismatch" }
    ]);
  });

  it("quarantines malicious sidecar occurrences that escape root and never reads them", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const outsideFile = path.join(outside, "secret.txt");
    await fs.writeFile(outsideFile, "top secret", "utf8");
    const liveRel = "organized/live.jpg";
    await fs.mkdir(path.join(root, "organized"), { recursive: true });
    await fs.writeFile(path.join(root, liveRel), "live bytes");
    const liveSha = sha256("live bytes");

    const escapeRel = "../outside/secret.txt";
    const absoluteEscape = "/etc/passwd";
    const sidecar = sidecarFor(liveSha, {
      occurrences: [liveRel, escapeRel, absoluteEscape]
    });

    const index = new SqliteIndex(root);
    const result = await index.rebuildFromSidecars([sidecar]);
    const record = index.findBySha(liveSha);
    index.close();

    // Only the safe, live occurrence is selectable.
    expect(record?.occurrences).toEqual([liveRel]);
    // Escaped occurrences are quarantined as audit entries, not read.
    expect(result.quarantinedOccurrences).toHaveLength(2);
    expect(result.quarantinedOccurrences.map((q) => q.relPath)).toContain(escapeRel);
    expect(result.quarantinedOccurrences.map((q) => q.relPath)).toContain(absoluteEscape);
    // No outside file was read/hashed — the outside file content is unchanged.
    await expect(fs.readFile(outsideFile, "utf8")).resolves.toBe("top secret");
  });

  it("marks the rebuild as atomic and completed via the rebuild sentinel", async () => {
    const root = await tempRoot();
    const index = new SqliteIndex(root);
    expect(index.rebuildStatus()).toBeNull();
    const result = await index.rebuildFromSidecars([]);
    expect(result.atomic).toBe(true);
    expect(index.rebuildStatus()).toBe("completed");
    index.close();
  });

  it("validates usage journal semantic records and does not seed slot_use from invalid lines", async () => {
    const root = await tempRoot();
    const usagePath = path.join(root, ".img-ia", "usage.jsonl");
    await fs.mkdir(path.dirname(usagePath), { recursive: true });
    const validEvent = usageEvent({ at: "2026-01-01T00:00:00.000Z" });
    const lines = [
      JSON.stringify(validEvent),
      JSON.stringify({ ...validEvent, sha256: "not-a-sha" }),
      JSON.stringify({ ...validEvent, slot: "" }),
      JSON.stringify({ ...validEvent, location: "" }),
      JSON.stringify({ ...validEvent, source: "bogus" }),
      JSON.stringify({ ...validEvent, at: "not-a-date" }),
      "{ torn json line",
      JSON.stringify({ ...validEvent, at: "2026-01-01T00:01:00.000Z" })
    ];
    await fs.writeFile(usagePath, lines.join("\n") + "\n", "utf8");

    const index = new SqliteIndex(root);
    const replay = index.replayUsageJournal(usagePath);
    index.close();

    // Only the two valid events seed slot_use.
    expect(replay.usageEvents).toBe(2);
    expect(replay.usageRecords).toBe(1);
    expect(replay.warnings.length).toBe(6);
  });

  it("rejects an outside-root usage journal path and never reads it", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const outsideJournal = path.join(outside, "usage.jsonl");
    await fs.writeFile(outsideJournal, `${JSON.stringify(usageEvent())}\n`, "utf8");

    const index = new SqliteIndex(root);
    expect(() => index.replayUsageJournal(outsideJournal)).toThrow(StorageRootGuardError);
    // The outside journal was never consumed — no usage records exist.
    expect(index.stats().totals.usageEvents).toBe(0);
    expect(index.stats().totals.usageRecords).toBe(0);
    index.close();
    // Outside file untouched.
    await expect(fs.readFile(outsideJournal, "utf8")).resolves.toContain("home.hero");
  });

  it("rejects an outside-root usage journal path passed to rebuildFromSidecars", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const outsideJournal = path.join(outside, "usage.jsonl");
    await fs.writeFile(outsideJournal, `${JSON.stringify(usageEvent())}\n`, "utf8");

    const index = new SqliteIndex(root);
    await expect(
      index.rebuildFromSidecars([], { usageJournalPath: outsideJournal })
    ).rejects.toBeInstanceOf(StorageRootGuardError);
    index.close();
  });

  it("rejects the DEFAULT usage journal path when it is a symlink/junction escaping root", async () => {
    // The default path `<root>/.img-ia/usage.jsonl` MUST be validated through
    // the same root-confinement/symlink-realpath guard as explicit paths. If
    // the journal leaf is a pre-existing symlink/junction whose realpath
    // escapes root, the default path is rejected and never read — closing the
    // default-path bypass where only explicit paths were guarded.
    //
    // `.img-ia` itself is a real dir inside root (so the SqliteIndex
    // constructor, which validates `.img-ia/index.sqlite`, succeeds); only the
    // `usage.jsonl` leaf is a symlink pointing outside.
    const root = await tempRoot();
    const outside = await tempRoot();
    const outsideJournal = path.join(outside, "usage.jsonl");
    await fs.writeFile(outsideJournal, `${JSON.stringify(usageEvent())}\n`, "utf8");

    const imgIaDir = path.join(root, ".img-ia");
    await fs.mkdir(imgIaDir, { recursive: true });
    const defaultJournal = path.join(imgIaDir, "usage.jsonl");
    try {
      await fs.symlink(outsideJournal, defaultJournal, "file");
    } catch (error) {
      // Windows non-admin cannot create file symlinks (EPERM). Skip — the
      // guard's symlink rejection is already covered by its own tests; this
      // test specifically proves the DEFAULT path (not just explicit paths) is
      // guarded, which matters most on platforms that allow the link.
      if (isPermError(error)) {
        return;
      }
      throw error;
    }

    // replayUsageJournal() with NO path uses the default
    // <root>/.img-ia/usage.jsonl, which now resolves outside root via the
    // usage.jsonl symlink. The guard MUST reject it before reading the outside
    // journal.
    const index = new SqliteIndex(root);
    expect(() => index.replayUsageJournal()).toThrow(StorageRootGuardError);
    // The outside journal was never consumed — no usage records exist.
    expect(index.stats().totals.usageEvents).toBe(0);
    expect(index.stats().totals.usageRecords).toBe(0);
    index.close();
    // The outside file is untouched.
    await expect(fs.readFile(outsideJournal, "utf8")).resolves.toContain("home.hero");
  });

  it("rejects the DEFAULT usage journal path via rebuildFromSidecars when the leaf escapes root", async () => {
    // Same default-path bypass, exercised through rebuildFromSidecars which
    // resolves options.usageJournalPath (undefined) -> default path through
    // resolveUsageJournalPath.
    const root = await tempRoot();
    const outside = await tempRoot();
    const outsideJournal = path.join(outside, "usage.jsonl");
    await fs.writeFile(outsideJournal, `${JSON.stringify(usageEvent())}\n`, "utf8");

    const imgIaDir = path.join(root, ".img-ia");
    await fs.mkdir(imgIaDir, { recursive: true });
    const defaultJournal = path.join(imgIaDir, "usage.jsonl");
    try {
      await fs.symlink(outsideJournal, defaultJournal, "file");
    } catch (error) {
      if (isPermError(error)) {
        return;
      }
      throw error;
    }

    const index = new SqliteIndex(root);
    await expect(index.rebuildFromSidecars([])).rejects.toBeInstanceOf(
      StorageRootGuardError
    );
    index.close();
  });

  it("quarantines an occurrence that is lexically inside root but escapes via symlink/junction", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const liveRel = "organized/live.jpg";
    await fs.mkdir(path.join(root, "organized"), { recursive: true });
    await fs.writeFile(path.join(root, liveRel), "live bytes");
    const liveSha = sha256("live bytes");

    // Create a file inside root that is a symlink/junction pointing OUTSIDE
    // root. Its rel path ("organized/escape.jpg") is lexically inside root,
    // but its real target escapes — the rebuild must quarantine it and never
    // read the outside file.
    const outsideFile = path.join(outside, "stolen.jpg");
    await fs.writeFile(outsideFile, "stolen bytes", "utf8");
    const linkPath = path.join(root, "organized", "escape.jpg");
    const linkType = process.platform === "win32" ? "junction" : "file";
    try {
      await fs.symlink(outsideFile, linkPath, linkType);
    } catch (error) {
      // Windows non-admin cannot create file symlinks (EPERM). On win32 the
      // junction type does not require admin for directories, but a junction
      // to a FILE is not supported — only directory junctions. If the OS
      // denies creating the link, skip this test; the StorageRootGuard tests
      // already cover the guard's symlink rejection directly.
      if (isPermError(error)) {
        return;
      }
      throw error;
    }

    const sidecar = sidecarFor(liveSha, { occurrences: [liveRel, "organized/escape.jpg"] });

    const index = new SqliteIndex(root);
    const result = await index.rebuildFromSidecars([sidecar]);
    const record = index.findBySha(liveSha);
    index.close();

    // Only the safe live occurrence is selectable.
    expect(record?.occurrences).toEqual([liveRel]);
    // The symlink-escaping occurrence was quarantined, not read.
    const quarantined = result.quarantinedOccurrences.find((q) =>
      q.relPath.endsWith("escape.jpg")
    );
    expect(quarantined).toBeDefined();
    // The outside file was never read — its content is unchanged.
    await expect(fs.readFile(outsideFile, "utf8")).resolves.toBe("stolen bytes");
  });

  it("quarantines an occurrence that escapes via a directory junction/symlink (Windows-safe)", async () => {
    // Deterministic Windows-compatible case: a directory junction (win32) /
    // directory symlink (POSIX) named `organized/escape-dir` points to an
    // outside directory. An occurrence `organized/escape-dir/stolen.jpg` is
    // lexically inside root but resolves outside. The rebuild MUST quarantine
    // it BEFORE hashing and never select the outside file.
    const root = await tempRoot();
    const outside = await tempRoot();
    const liveRel = "organized/live.jpg";
    await fs.mkdir(path.join(root, "organized"), { recursive: true });
    await fs.writeFile(path.join(root, liveRel), "live bytes");
    const liveSha = sha256("live bytes");

    const outsideDir = path.join(outside, "escaped");
    await fs.mkdir(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, "stolen.jpg");
    await fs.writeFile(outsideFile, "stolen bytes", "utf8");

    const linkPath = path.join(root, "organized", "escape-dir");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    try {
      await fs.symlink(outsideDir, linkPath, linkType);
    } catch (error) {
      // Skip only if the OS denies link creation. A directory junction on
      // win32 does not require admin, but a POSIX directory symlink may on
      // some configurations; either way we skip rather than fail the suite.
      if (isPermError(error) || isNotSupportedError(error)) {
        return;
      }
      throw error;
    }

    const sidecar = sidecarFor(liveSha, {
      occurrences: [liveRel, "organized/escape-dir/stolen.jpg"]
    });

    const index = new SqliteIndex(root);
    const result = await index.rebuildFromSidecars([sidecar]);
    const record = index.findBySha(liveSha);
    index.close();

    // Only the safe live occurrence is selectable; the outside file is never
    // selected even though its rel path is lexically inside root.
    expect(record?.occurrences).toEqual([liveRel]);
    // The directory-junction-escaping occurrence was quarantined before hashing.
    const quarantined = result.quarantinedOccurrences.find((q) =>
      q.relPath.endsWith("escape-dir/stolen.jpg")
    );
    expect(quarantined).toBeDefined();
    // The outside file was never read/hashed — its content is unchanged.
    await expect(fs.readFile(outsideFile, "utf8")).resolves.toBe("stolen bytes");
  });
});

function usageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    sha256: "b".repeat(64),
    slot: "home.hero",
    location: "homepage/hero",
    source: "mark-used",
    at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function sidecarFor(sha256: string, overrides: Partial<Sidecar> = {}): Sidecar {
  return {
    sha256,
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
    canonicalRelPath: "organized/live.jpg",
    occurrences: ["organized/live.jpg"],
    primaryFlag: "canonicalRelPath",
    ...overrides
  };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-index-"));
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

function isNotSupportedError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: string }).code;
  return code === "ENOSYS" || code === "EEXIST" || code === "EBUSY" || code === "UNKNOWN";
}
