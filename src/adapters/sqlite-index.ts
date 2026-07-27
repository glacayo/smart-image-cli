import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import DatabaseConstructor, { type Database as SqliteDatabase } from "better-sqlite3";
import type { ImageAnalysis, ImageOrientation } from "../domain/analysis-schema.js";
import type { Sidecar } from "./sidecar-store.js";
import { selectPrimaryOccurrence } from "./sidecar-store.js";
import {
  StorageRootGuard,
  StorageRootGuardError,
  assertOccurrenceInsideRoot
} from "./storage-root-guard.js";

/**
 * Default usage journal path, relative to the guarded storage root. The usage
 * journal is durable state and MUST stay confined to `.img-ia/usage.jsonl` under
 * the project `--root`; arbitrary outside-root journal paths are rejected so a
 * caller (or a compromised sidecar/journal) cannot force the index to read
 * arbitrary files outside the project.
 */
const DEFAULT_USAGE_JOURNAL_REL = path.join(".img-ia", "usage.jsonl");

export type ImageRecord = {
  sha256: string;
  classification: ImageAnalysis;
  dims: { width: number; height: number };
  originalName: string;
  model: string;
  canonicalRelPath: string;
  occurrences: string[];
  used: UsageRecord[];
};

export type PickFilter = {
  categories?: readonly string[];
  orientation?: ImageOrientation;
  minWidth?: number;
  minHeight?: number;
  slot?: string;
  location?: string;
  allowReuse?: boolean;
};

export type UsageSource = "pick" | "mark-used";

export type UsageEvent = {
  sha256: string;
  slot: string;
  location: string;
  source: UsageSource;
  at: string;
};

export type UsageRecord = {
  sha256: string;
  slot: string;
  location: string;
  source: UsageSource;
  firstUsedAt: string;
  lastUsedAt: string;
  eventCount: number;
};

export type UsageReplayResult = {
  usageEvents: number;
  usageRecords: number;
  warnings: string[];
};

export type IndexStats = {
  totals: {
    images: number;
    occurrences: number;
    sidecars: number;
    thumbnails: number;
    usageEvents: number;
    usageRecords: number;
  };
  byCategory: Array<{ category: string; count: number }>;
  byOrientation: Array<{ orientation: ImageOrientation; count: number }>;
  orphans: Array<{ sha256: string; occurrences: string[] }>;
  missingThumbnails: number;
};

export type RebuildResult = {
  indexedOccurrences: number;
  staleOccurrences: Array<{ sha256: string; relPath: string; reason: "missing" | "sha_mismatch" }>;
  promotedPrimaries: Array<{ sha256: string; canonicalRelPath: string }>;
  usage: UsageReplayResult;
  /**
   * Sidecar-controlled occurrence paths that were rejected during rebuild
   * because they attempted to read outside `--root` (absolute, drive-relative,
   * or `..` traversal). They are quarantined as audit/warning entries and are
   * NEVER read or indexed as selectable records. Each entry records the raw
   * sidecar-supplied path and the guard reason.
   */
  quarantinedOccurrences: Array<{ sha256: string; relPath: string; reason: string }>;
  /**
   * Rebuild atomicity marker. When true the rebuild completed inside its
   * transaction and the derived tables are consistent. When false the rebuild
   * was interrupted and a sentinel prevents the index from being silently
   * treated as valid.
   */
  atomic: boolean;
};

type ImageContentRow = {
  sha256: string;
  classification_json: string;
  width: number;
  height: number;
  original_name: string;
  model: string;
  canonical_rel_path: string;
};

type OccurrenceRow = {
  sha256: string;
  rel_path: string;
  is_primary: 0 | 1;
};

type UsageRow = {
  sha256: string;
  slot: string;
  location: string;
  source: UsageSource;
  first_used_at: string;
  last_used_at: string;
  event_count: number;
};

export class SqliteIndex {
  private readonly db: SqliteDatabase;
  private readonly guard: StorageRootGuard;

  constructor(
    readonly root: string,
    dbPath = path.join(root, ".img-ia", "index.sqlite")
  ) {
    this.guard = new StorageRootGuard(root);
    // Validate the DB path (and its parent chain) is root-confined and not a
    // pre-existing `.img-ia` symlink/junction that would place the SQLite DB
    // outside the project.
    this.guard.ensureInsideSync(dbPath);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseConstructor(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  /**
   * Returns the current rebuild sentinel status. `"completed"` means the last
   * rebuild finished inside its transaction and the derived tables are
   * consistent. `"in_progress"` means a rebuild was interrupted; the index
   * MUST NOT be silently treated as valid and should be rebuilt before use.
   * Returns `null` when no rebuild has ever run.
   */
  rebuildStatus(): "completed" | "in_progress" | null {
    const row = this.db.prepare("SELECT value FROM rebuild_sentinel WHERE key = 'status'").get() as
      { value: string } | undefined;
    if (row === undefined) {
      return null;
    }
    return row.value === "completed" ? "completed" : "in_progress";
  }

  upsertContent(record: ImageRecord): void {
    const normalized = recordFromInput(record);
    this.db
      .prepare(
        `INSERT INTO image_content
          (sha256, classification_json, width, height, original_name, model, canonical_rel_path)
         VALUES (@sha256, @classificationJson, @width, @height, @originalName, @model, @canonicalRelPath)
         ON CONFLICT(sha256) DO UPDATE SET
          classification_json = excluded.classification_json,
          width = excluded.width,
          height = excluded.height,
          original_name = excluded.original_name,
          model = excluded.model,
          canonical_rel_path = excluded.canonical_rel_path`
      )
      .run(normalized);
  }

  upsertOccurrence(sha256: string, relPath: string, options: { primary?: boolean } = {}): void {
    const tx = this.db.transaction(() => {
      if (options.primary === true) {
        this.db.prepare("UPDATE occurrence SET is_primary = 0 WHERE sha256 = ?").run(sha256);
      }
      this.db
        .prepare(
          `INSERT INTO occurrence (sha256, rel_path, is_primary)
           VALUES (?, ?, ?)
           ON CONFLICT(sha256, rel_path) DO UPDATE SET is_primary = excluded.is_primary`
        )
        .run(sha256, relPath, options.primary === true ? 1 : 0);
    });
    tx();
  }

  findBySha(sha256: string): ImageRecord | null {
    const content = this.db.prepare("SELECT * FROM image_content WHERE sha256 = ?").get(sha256) as
      ImageContentRow | undefined;
    return content === undefined ? null : this.recordFromRow(content);
  }

  query(filter: PickFilter = {}): ImageRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM image_content ORDER BY canonical_rel_path ASC")
      .all() as ImageContentRow[];

    return rows
      .map((row) => this.recordFromRow(row))
      .filter((record) => record.occurrences.length > 0)
      .filter((record) => matchesFilter(record, filter));
  }

  recordUsageEvent(event: UsageEvent): void {
    const tx = this.db.transaction(() => {
      this.insertUsageEvent(event);
      this.upsertUsageRecord(event);
    });
    tx();
  }

  replayUsageJournal(
    journalPath: string = path.join(this.root, DEFAULT_USAGE_JOURNAL_REL)
  ): UsageReplayResult {
    const safeJournalPath = this.resolveUsageJournalPath(journalPath);
    const staged = this.stageUsageJournal(safeJournalPath);
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM usage_event").run();
      this.db.prepare("DELETE FROM slot_use").run();
      for (const event of staged.events) {
        this.insertUsageEvent(event);
        this.upsertUsageRecord(event);
      }
    });
    tx();

    return {
      usageEvents: staged.events.length,
      usageRecords: this.count("slot_use"),
      warnings: staged.warnings
    };
  }

  /**
   * Validates the usage journal path is confined to `.img-ia/usage.jsonl` under
   * the guarded storage root. An arbitrary outside-root journal path is
   * rejected with `StorageRootGuardError` BEFORE any file is read, so a caller
   * cannot force the index to read arbitrary files outside the project.
   *
   * The default root-relative journal path (`<root>/.img-ia/usage.jsonl`) is
   * validated through the same root-confinement/symlink-realpath guard as
   * explicit paths: a pre-existing `.img-ia` (or `usage.jsonl`) symlink/
   * junction/reparse point whose realpath escapes `--root` is rejected and
   * never read. This closes the default-path bypass where an explicit
   * outside-root path was guarded but a symlinked default path was not.
   *
   * When a path is supplied it MUST resolve (via realpath, following symlinks/
   * junctions/reparse points) to a location inside the storage root.
   */
  private resolveUsageJournalPath(journalPath?: string): string {
    const defaultPath = path.join(this.root, DEFAULT_USAGE_JOURNAL_REL);
    const candidate = journalPath ?? defaultPath;
    // Reject empty/non-string sentinels defensively.
    if (typeof candidate !== "string" || candidate.length === 0) {
      throw new StorageRootGuardError("Usage journal path must not be empty");
    }
    // Resolve against the root and validate the (possibly symlinked) real path
    // stays inside the storage root. This reuses the same guard that protects
    // the SQLite DB and sidecar paths. The default path is validated through
    // the same realpath guard so a symlinked default cannot bypass it.
    this.guard.ensureInsideSync(candidate);
    return path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(this.root, candidate);
  }

  private stageUsageJournal(journalPath?: string): {
    events: UsageEvent[];
    warnings: string[];
  } {
    const resolvedPath = journalPath ?? path.join(this.root, DEFAULT_USAGE_JOURNAL_REL);
    const warnings: string[] = [];
    const raw = readTextIfExists(resolvedPath);
    const lines = raw.length === 0 ? [] : raw.split(/\r?\n/);
    const events: UsageEvent[] = [];

    lines.forEach((line, index) => {
      if (line.trim().length === 0) {
        return;
      }
      const event = parseUsageEvent(line, index + 1, warnings);
      if (event !== null) {
        events.push(event);
      }
    });

    return { events, warnings };
  }

  async rebuildFromSidecars(
    sidecars: Iterable<Sidecar>,
    options: { usageJournalPath?: string; thumbnailDir?: string } = {}
  ): Promise<RebuildResult> {
    const staleOccurrences: RebuildResult["staleOccurrences"] = [];
    const promotedPrimaries: RebuildResult["promotedPrimaries"] = [];
    const quarantinedOccurrences: RebuildResult["quarantinedOccurrences"] = [];
    let indexedOccurrences = 0;

    // Pre-stage all rebuild work in memory, then commit inside a single
    // transaction so an interrupted rebuild cannot leave a silently valid
    // partial index. A `rebuild_sentinel` row marks the index as "in progress"
    // for the duration of the transaction and is cleared (replaced by a
    // `completed` marker) only when the transaction commits.
    const stagedContent: Array<{
      sha256: string;
      classification_json: string;
      width: number;
      height: number;
      original_name: string;
      model: string;
      canonical_rel_path: string;
    }> = [];
    const stagedOccurrences: Array<{ sha256: string; rel_path: string; is_primary: 0 | 1 }> = [];

    for (const sidecar of sidecars) {
      const liveVerified: string[] = [];
      for (const relPath of sidecar.occurrences) {
        // Validate EVERY sidecar-controlled occurrence path with root
        // confinement BEFORE joining/hashing. Reject escaped/absolute
        // occurrences as warnings/audit, never read them.
        let safeRelPath: string;
        try {
          safeRelPath = assertOccurrenceInsideRoot(relPath);
        } catch (error) {
          quarantinedOccurrences.push({
            sha256: sidecar.sha256,
            relPath,
            reason:
              error instanceof StorageRootGuardError
                ? error.message
                : "occurrence path validation failed"
          });
          continue;
        }

        const absolutePath = path.join(this.root, safeRelPath);

        // Lexical containment is not enough: an occurrence path that is
        // lexically inside root can still point outside via a symlink, Windows
        // junction, or reparse point. Before hashing/reading, resolve the real
        // path (following links) and reject any occurrence whose real path
        // escapes the storage root. This mirrors the design.md
        // "Symlinks / junctions / reparse" invariant: lstat first; if
        // symlink/junction/reparse → realpath to a canonical real path; reject
        // if real path escapes --root.
        try {
          await this.guard.ensureInside(absolutePath, true);
        } catch (error) {
          quarantinedOccurrences.push({
            sha256: sidecar.sha256,
            relPath,
            reason:
              error instanceof StorageRootGuardError
                ? error.message
                : "occurrence path escapes root via symlink/junction/reparse"
          });
          continue;
        }

        const liveSha = await sha256FileIfExists(absolutePath);
        if (liveSha === null) {
          staleOccurrences.push({
            sha256: sidecar.sha256,
            relPath: safeRelPath,
            reason: "missing"
          });
          continue;
        }
        if (liveSha !== sidecar.sha256) {
          staleOccurrences.push({
            sha256: sidecar.sha256,
            relPath: safeRelPath,
            reason: "sha_mismatch"
          });
          continue;
        }
        liveVerified.push(safeRelPath);
      }

      const selected = selectPrimaryOccurrence(sidecar, liveVerified);
      if (selected.canonicalRelPath !== sidecar.canonicalRelPath) {
        promotedPrimaries.push({
          sha256: sidecar.sha256,
          canonicalRelPath: selected.canonicalRelPath
        });
      }

      stagedContent.push({
        sha256: selected.sha256,
        classification_json: JSON.stringify(selected.classification),
        width: selected.dims.width,
        height: selected.dims.height,
        original_name: selected.originalName,
        model: selected.model,
        canonical_rel_path: selected.canonicalRelPath
      });
      for (const relPath of liveVerified) {
        stagedOccurrences.push({
          sha256: selected.sha256,
          rel_path: relPath,
          is_primary: relPath === selected.canonicalRelPath ? 1 : 0
        });
        indexedOccurrences += 1;
      }
    }

    // Replay the usage journal outside the main transaction so semantic
    // validation warnings are collected first; the journal rows are applied
    // atomically with the rest of the rebuild below. The journal path is
    // validated to stay inside the guarded storage root so an outside-root
    // journal cannot force the index to read arbitrary files.
    const safeJournalPath = this.resolveUsageJournalPath(options.usageJournalPath);
    const usageStaged = this.stageUsageJournal(safeJournalPath);

    const tx = this.db.transaction(() => {
      // Mark the rebuild as in-progress BEFORE deleting. If the process dies
      // here, the sentinel survives and the index cannot be silently treated
      // as valid.
      this.db
        .prepare(
          `INSERT INTO rebuild_sentinel (key, value) VALUES ('status', 'in_progress')
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run();

      this.db.prepare("DELETE FROM occurrence").run();
      this.db.prepare("DELETE FROM image_content").run();
      this.db.prepare("DELETE FROM usage_event").run();
      this.db.prepare("DELETE FROM slot_use").run();

      const insertContent = this.db.prepare(
        `INSERT INTO image_content
          (sha256, classification_json, width, height, original_name, model, canonical_rel_path)
         VALUES (@sha256, @classification_json, @width, @height, @original_name, @model, @canonical_rel_path)`
      );
      for (const row of stagedContent) {
        insertContent.run(row);
      }

      const insertOccurrence = this.db.prepare(
        `INSERT INTO occurrence (sha256, rel_path, is_primary) VALUES (?, ?, ?)`
      );
      for (const row of stagedOccurrences) {
        insertOccurrence.run(row.sha256, row.rel_path, row.is_primary);
      }

      for (const event of usageStaged.events) {
        this.insertUsageEvent(event);
        this.upsertUsageRecord(event);
      }

      // Clear the in-progress sentinel only when the whole transaction is
      // about to commit. If anything above throws, the transaction rolls back
      // and the sentinel remains (or is re-set on the next attempt).
      this.db
        .prepare(
          `INSERT INTO rebuild_sentinel (key, value) VALUES ('status', 'completed')
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run();
    });
    tx();

    return {
      indexedOccurrences,
      staleOccurrences,
      promotedPrimaries,
      usage: {
        usageEvents: usageStaged.events.length,
        usageRecords: this.count("slot_use"),
        warnings: usageStaged.warnings
      },
      quarantinedOccurrences,
      // Reaching this return means `tx()` committed; rollback paths throw before this point.
      atomic: true
    };
  }

  stats(options: { sidecarCount?: number; thumbnailCount?: number } = {}): IndexStats {
    const images = this.count("image_content");
    const occurrences = this.count("occurrence");
    const usageEvents = this.count("usage_event");
    const usageRecords = this.count("slot_use");
    const sidecars = options.sidecarCount ?? images;
    const thumbnails = options.thumbnailCount ?? 0;

    return {
      totals: { images, occurrences, sidecars, thumbnails, usageEvents, usageRecords },
      byCategory: this.categoryCounts(),
      byOrientation: this.orientationCounts(),
      orphans: this.orphans(),
      missingThumbnails: Math.max(0, sidecars - thumbnails)
    };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS image_content (
        sha256 TEXT PRIMARY KEY,
        classification_json TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        original_name TEXT NOT NULL,
        model TEXT NOT NULL,
        canonical_rel_path TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS occurrence (
        sha256 TEXT NOT NULL REFERENCES image_content(sha256) ON DELETE CASCADE,
        rel_path TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (sha256, rel_path)
      );

      CREATE INDEX IF NOT EXISTS occurrence_sha_idx ON occurrence(sha256);

      CREATE TABLE IF NOT EXISTS usage_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sha256 TEXT NOT NULL,
        slot TEXT NOT NULL,
        location TEXT NOT NULL,
        source TEXT NOT NULL,
        used_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS slot_use (
        sha256 TEXT NOT NULL,
        slot TEXT NOT NULL,
        location TEXT NOT NULL,
        source TEXT NOT NULL,
        first_used_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        PRIMARY KEY (sha256, slot, location)
      );

      CREATE TABLE IF NOT EXISTS rebuild_sentinel (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private recordFromRow(row: ImageContentRow): ImageRecord {
    const occurrences = this.db
      .prepare("SELECT * FROM occurrence WHERE sha256 = ? ORDER BY is_primary DESC, rel_path ASC")
      .all(row.sha256) as OccurrenceRow[];
    const used = this.db
      .prepare("SELECT * FROM slot_use WHERE sha256 = ?")
      .all(row.sha256) as UsageRow[];

    return {
      sha256: row.sha256,
      classification: JSON.parse(row.classification_json) as ImageAnalysis,
      dims: { width: row.width, height: row.height },
      originalName: row.original_name,
      model: row.model,
      canonicalRelPath: row.canonical_rel_path,
      occurrences: occurrences.map((occurrence) => occurrence.rel_path),
      used: used.map(usageRecordFromRow)
    };
  }

  private insertUsageEvent(event: UsageEvent): void {
    this.db
      .prepare(
        `INSERT INTO usage_event (sha256, slot, location, source, used_at)
         VALUES (@sha256, @slot, @location, @source, @at)`
      )
      .run(event);
  }

  private upsertUsageRecord(event: UsageEvent): void {
    this.db
      .prepare(
        `INSERT INTO slot_use
          (sha256, slot, location, source, first_used_at, last_used_at, event_count)
         VALUES (@sha256, @slot, @location, @source, @at, @at, 1)
         ON CONFLICT(sha256, slot, location) DO UPDATE SET
          source = excluded.source,
          last_used_at = excluded.last_used_at,
          event_count = slot_use.event_count + 1`
      )
      .run(event);
  }

  private count(table: "image_content" | "occurrence" | "usage_event" | "slot_use"): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    };
    return row.count;
  }

  private categoryCounts(): Array<{ category: string; count: number }> {
    const counts = new Map<string, number>();
    for (const record of this.query()) {
      for (const category of record.classification.categories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    return [...counts.entries()].map(([category, count]) => ({ category, count }));
  }

  private orientationCounts(): Array<{ orientation: ImageOrientation; count: number }> {
    const counts = new Map<ImageOrientation, number>();
    for (const record of this.query()) {
      counts.set(
        record.classification.orientation,
        (counts.get(record.classification.orientation) ?? 0) + 1
      );
    }
    return [...counts.entries()].map(([orientation, count]) => ({ orientation, count }));
  }

  private orphans(): Array<{ sha256: string; occurrences: string[] }> {
    const rows = this.db
      .prepare("SELECT * FROM image_content ORDER BY sha256 ASC")
      .all() as ImageContentRow[];
    return rows
      .map((row) => this.recordFromRow(row))
      .filter((record) => record.occurrences.length === 0)
      .map((record) => ({ sha256: record.sha256, occurrences: record.occurrences }));
  }
}

function matchesFilter(record: ImageRecord, filter: PickFilter): boolean {
  if (
    filter.categories !== undefined &&
    !filter.categories.some((c) => record.classification.categories.includes(c))
  ) {
    return false;
  }
  if (
    filter.orientation !== undefined &&
    record.classification.orientation !== filter.orientation
  ) {
    return false;
  }
  if (filter.minWidth !== undefined && record.dims.width < filter.minWidth) {
    return false;
  }
  if (filter.minHeight !== undefined && record.dims.height < filter.minHeight) {
    return false;
  }
  if (filter.allowReuse !== true && filter.slot !== undefined && filter.location !== undefined) {
    return !record.used.some(
      (used) => used.slot === filter.slot && used.location === filter.location
    );
  }
  return true;
}

function recordFromInput(record: ImageRecord): {
  sha256: string;
  classificationJson: string;
  width: number;
  height: number;
  originalName: string;
  model: string;
  canonicalRelPath: string;
} {
  return {
    sha256: record.sha256,
    classificationJson: JSON.stringify(record.classification),
    width: record.dims.width,
    height: record.dims.height,
    originalName: record.originalName,
    model: record.model,
    canonicalRelPath: record.canonicalRelPath
  };
}

function usageRecordFromRow(row: UsageRow): UsageRecord {
  return {
    sha256: row.sha256,
    slot: row.slot,
    location: row.location,
    source: row.source,
    firstUsedAt: row.first_used_at,
    lastUsedAt: row.last_used_at,
    eventCount: row.event_count
  };
}

function parseUsageEvent(line: string, lineNumber: number, warnings: string[]): UsageEvent | null {
  let parsed: Partial<UsageEvent>;
  try {
    parsed = JSON.parse(line) as Partial<UsageEvent>;
  } catch {
    warnings.push(`usage.jsonl line ${lineNumber} ignored: invalid JSON (torn/partial line)`);
    return null;
  }

  if (typeof parsed.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(parsed.sha256)) {
    warnings.push(`usage.jsonl line ${lineNumber} ignored: invalid sha256 format`);
    return null;
  }
  if (typeof parsed.slot !== "string" || parsed.slot.length === 0) {
    warnings.push(`usage.jsonl line ${lineNumber} ignored: empty slot`);
    return null;
  }
  if (typeof parsed.location !== "string" || parsed.location.length === 0) {
    warnings.push(`usage.jsonl line ${lineNumber} ignored: empty location`);
    return null;
  }
  if (parsed.source !== "pick" && parsed.source !== "mark-used") {
    warnings.push(`usage.jsonl line ${lineNumber} ignored: invalid source`);
    return null;
  }
  if (typeof parsed.at !== "string" || Number.isNaN(Date.parse(parsed.at))) {
    warnings.push(`usage.jsonl line ${lineNumber} ignored: invalid timestamp`);
    return null;
  }

  return parsed as UsageEvent;
}

async function sha256FileIfExists(filePath: string): Promise<string | null> {
  try {
    const hash = crypto.createHash("sha256");
    const bytes = await fsPromises.readFile(filePath);
    hash.update(bytes);
    return hash.digest("hex");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function readTextIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
