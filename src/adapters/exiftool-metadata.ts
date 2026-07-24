import fs from "node:fs/promises";
import { exiftool, type Tags, type WriteTags, type WriteTaskResult } from "exiftool-vendored";
import {
  defaultSecretRedactor,
  redactErrorMessage,
  type SecretRedactor
} from "./secret-redactor.js";

export type TagMap = Record<string, unknown>;

/**
 * Minimal seam of the exiftool-vendored methods used by `ExiftoolMetadata`.
 * Production code injects the real singleton; tests inject a stub to verify
 * cleanup/error behavior without spawning a native ExifTool process.
 */
export type ExiftoolSeam = {
  read(filePath: string): Promise<Tags>;
  write(file: string, tags: WriteTags, writeArgs?: string[]): Promise<WriteTaskResult>;
};

export class MetadataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MetadataError";
  }
}

/**
 * Options for {@link ExiftoolMetadata}.
 *
 * `timeoutMs` bounds every ExifTool seam operation (`read`, `stripAll`, and
 * `reapplyTags`) so a hung native process or a never-resolving seam can never
 * block indefinitely. When the deadline elapses the pending operation is
 * rejected with a typed {@link MetadataError} instead of hanging forever.
 *
 * Defaults to 30000ms (30s). Pass `0` or a negative value to disable the
 * deadline (not recommended outside tests).
 */
export type ExiftoolMetadataOptions = {
  /**
   * Per-operation deadline in milliseconds. When the underlying seam call does
   * not settle before this deadline, it is abandoned and a typed
   * {@link MetadataError} is thrown. Defaults to 30000 (30s).
   */
  timeoutMs?: number;
};

/** Default ExifTool seam operation deadline: 30 seconds. */
const DEFAULT_EXIFTOOL_TIMEOUT_MS = 30_000;

export class ExiftoolMetadata {
  private readonly exiftool: ExiftoolSeam;
  private readonly timeoutMs: number;

  constructor(
    private readonly redactor: SecretRedactor = defaultSecretRedactor,
    exiftoolSeam?: ExiftoolSeam,
    options: ExiftoolMetadataOptions = {}
  ) {
    this.exiftool = exiftoolSeam ?? exiftool;
    const requested = options.timeoutMs ?? DEFAULT_EXIFTOOL_TIMEOUT_MS;
    this.timeoutMs = requested > 0 ? requested : 0;
  }

  async read(inputPath: string): Promise<TagMap> {
    try {
      const tags = await this.withTimeout(() => this.exiftool.read(inputPath), "read", inputPath);
      return normalizeTags(tags);
    } catch (error) {
      throw new MetadataError(
        `Unable to read metadata from ${inputPath}: ${redactErrorMessage(error, this.redactor)}`,
        { cause: error }
      );
    }
  }

  async stripAll(inputPath: string): Promise<void> {
    // ExifTool's `deleteAllTags` does not expose a `writeArgs` override (it
    // hard-codes `-all=` and its own `writeArgs`), so it may create an
    // `_original` backup. We use `exiftool.write` directly with
    // `-overwrite_original_in_place` so ExifTool does NOT create the backup in
    // the first place. The `finally` cleanup below is the second line of
    // defense: even on failure, any `_original` that slipped through is removed
    // so a privacy-leaking backup cannot persist.
    try {
      await this.withTimeout(
        () => this.exiftool.write(inputPath, {}, ["-all=", "-overwrite_original_in_place"]),
        "stripAll",
        inputPath
      );
    } catch (error) {
      throw new MetadataError(
        `Unable to strip metadata from ${inputPath}: ${redactErrorMessage(error, this.redactor)}`,
        { cause: error }
      );
    } finally {
      // Always attempt cleanup of the `_original` backup, even on failure, so
      // a privacy-leaking copy never persists alongside the caller's file.
      await fs.rm(`${inputPath}_original`, { force: true }).catch(() => undefined);
    }
  }

  async reapplyTags(inputPath: string, tags: TagMap): Promise<void> {
    try {
      const writable = filterWritableTags(tags);
      if (Object.keys(writable).length === 0) {
        return;
      }
      await this.withTimeout(
        () => this.exiftool.write(inputPath, writable, ["-overwrite_original"]),
        "reapplyTags",
        inputPath
      );
    } catch (error) {
      throw new MetadataError(
        `Unable to reapply metadata to ${inputPath}: ${redactErrorMessage(error, this.redactor)}`,
        { cause: error }
      );
    }
  }

  /**
   * Wraps an ExifTool seam operation with a deadline. When `timeoutMs > 0` and
   * `operation` does not settle before the deadline elapses, the call is
   * abandoned and a typed {@link MetadataError} is thrown so ExifTool can never
   * hang the process forever. The timed-out operation is NOT cancelled (the
   * native process may keep running), but its result is discarded.
   */
  private async withTimeout<T>(
    operation: () => Promise<T>,
    operationName: string,
    inputPath: string
  ): Promise<T> {
    if (this.timeoutMs <= 0) {
      return operation();
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new MetadataError(
            `ExifTool ${operationName} timed out after ${this.timeoutMs}ms on ${inputPath}`,
            { cause: { operation: operationName, timeoutMs: this.timeoutMs, inputPath } }
          )
        );
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([operation(), timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

function normalizeTags(tags: Tags): TagMap {
  const normalized: TagMap = {};
  for (const [key, value] of Object.entries(tags)) {
    if (key === "SourceFile" || key === "errors") {
      continue;
    }
    normalized[key] = serializeTagValue(value);
  }
  return normalized;
}

function filterWritableTags(tags: TagMap): TagMap {
  const writable: TagMap = {};
  for (const [key, value] of Object.entries(tags)) {
    if (NON_WRITABLE_READ_TAGS.has(key) || value === undefined) {
      continue;
    }
    writable[key] = value;
  }
  return writable;
}

const NON_WRITABLE_READ_TAGS = new Set([
  "SourceFile",
  "errors",
  "Directory",
  "FileName",
  "FilePermissions",
  "FileSize",
  "FileType",
  "FileTypeExtension",
  "MIMEType",
  "ExifToolVersion",
  "ImageWidth",
  "ImageHeight",
  "Megapixels",
  "EncodingProcess",
  "BitsPerSample",
  "ColorComponents",
  "YCbCrSubSampling"
]);

function serializeTagValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(serializeTagValue);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (
    typeof value === "object" &&
    "toISOString" in value &&
    typeof value.toISOString === "function"
  ) {
    return value.toISOString();
  }
  if (typeof value === "object" && "rawValue" in value) {
    return String(value.rawValue);
  }
  return String(value);
}
