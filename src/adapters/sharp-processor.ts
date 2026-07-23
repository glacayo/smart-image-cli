import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { ImageFormat, ImageInfo, ResizePlan } from "../domain/resize-planner.js";
import { fsyncDirectoryHonest, type StorageRootGuard } from "./storage-root-guard.js";

export type ProbedImageInfo = ImageInfo & {
  orientation?: number;
  space?: string;
  hasAlpha?: boolean;
};

export type ProducedAsset = {
  path: string;
  width: number;
  height: number;
  format: ImageFormat;
  bytes: number;
};

export class DecodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DecodeError";
  }
}

export class WriteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WriteError";
  }
}

export class SharpProcessor {
  private readonly guard: StorageRootGuard | undefined;

  /**
   * @param guard Optional {@link StorageRootGuard} that confines every adapter
   *   write (output path + temp files) to a project `--root`. When provided,
   *   `produce` validates the output path and its parent chain stay inside the
   *   root before any file is written, and rejects symlink/junction escapes.
   *   When omitted, root confinement is the caller's responsibility; `produce`
   *   still writes to the exact `outputPath` given but cannot guarantee it is
   *   root-confined.
   */
  constructor(guard?: StorageRootGuard) {
    this.guard = guard;
  }

  async probe(inputPath: string): Promise<ProbedImageInfo> {
    try {
      const metadata = await sharp(inputPath).metadata();
      if (metadata.width === undefined || metadata.height === undefined) {
        throw new DecodeError(`Image dimensions unavailable: ${inputPath}`);
      }

      const info: ProbedImageInfo = {
        width: metadata.width,
        height: metadata.height
      };
      const format = normalizeSharpFormat(metadata.format);
      if (format !== undefined) {
        info.format = format;
      }
      if (metadata.orientation !== undefined) {
        info.orientation = metadata.orientation;
      }
      if (metadata.space !== undefined) {
        info.space = metadata.space;
      }
      if (metadata.hasAlpha !== undefined) {
        info.hasAlpha = metadata.hasAlpha;
      }
      return info;
    } catch (error) {
      if (error instanceof DecodeError) {
        throw error;
      }
      throw new DecodeError(`Unable to decode image: ${inputPath}`, { cause: error });
    }
  }

  async downscaleForVision(inputPath: string, maxEdge = 1024): Promise<Buffer> {
    try {
      return await sharp(inputPath)
        .rotate()
        .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch (error) {
      throw new DecodeError(`Unable to downscale image for vision: ${inputPath}`, { cause: error });
    }
  }

  async produce(inputPath: string, outputPath: string, plan: ResizePlan): Promise<ProducedAsset> {
    // When a root guard is configured, validate the output path and its parent
    // chain stay inside the project root BEFORE any file is written. A
    // pre-existing output path that is a symlink/junction escaping root is
    // rejected here rather than silently written through.
    //
    // Two distinct guard checks are required:
    //  1. `ensureInside(outputPath, mustExist=true)` — if the output LEAF
    //     already exists as a symlink/junction/reparse point whose realpath
    //     escapes root, reject it here via the guard (StorageRootGuardError)
    //     rather than relying on a later EEXIST WriteError from the atomic
    //     link finalization. The EEXIST path does not distinguish an escaping
    //     symlink from an innocent pre-existing regular file; the guard does,
    //     and it must reject escapes explicitly and before any temp file is
    //     written. When the leaf does not exist yet, `ensureInside` treats the
    //     missing leaf as a no-op reparse and returns the absolute path.
    //  2. `ensureParentInside(outputPath)` — validate/create the parent chain
    //     so the directory tree is root-confined before the temp file is
    //     written into it.
    if (this.guard !== undefined) {
      await this.guard.ensureInside(outputPath, true);
      await this.guard.ensureParentInside(outputPath);
    }

    const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
    let wroteTemp = false;
    try {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      const pipeline = sharp(inputPath)
        .rotate()
        .resize({
          width: plan.width,
          height: plan.height,
          fit: plan.op === "crop" ? "cover" : "inside",
          withoutEnlargement: plan.withoutEnlargement
        });

      if (plan.keepMetadata) {
        pipeline.keepMetadata();
      }

      let info;
      try {
        info = await pipeline
          .toFormat(toSharpFormat(plan.format), { quality: plan.quality })
          .toFile(tempPath);
        wroteTemp = true;
      } catch (error) {
        // A failure before/while writing the temp file: if it looks like a
        // decode/parse failure of the INPUT, surface it as DecodeError; only
        // true write-target failures (disk full, permissions on the temp path)
        // are WriteError. sharp throws an InputError for undecodable input.
        if (isSharpDecodeError(error)) {
          throw new DecodeError(`Unable to decode image for produce: ${inputPath}`, {
            cause: error
          });
        }
        throw new WriteError(`Unable to write image asset temp: ${tempPath}`, { cause: error });
      }

      await fsyncFile(tempPath);

      // Atomic, no-overwrite finalization: `fs.link(temp, output)` creates the
      // final entry only if `output` does NOT already exist (link fails with
      // EEXIST on collision). This removes the TOCTOU window the previous
      // stat-then-rename pair had: between `rejectExistingTarget` and
      // `fs.rename` a foreign writer could create the target and our rename
      // would silently clobber it. `link` is atomic and refuses to overwrite,
      // then we unlink the temp. On platforms where `link` is unavailable we
      // fall back to the stat-then-rename path (documented best-effort).
      await finalizeNoOverwrite(tempPath, outputPath);
      wroteTemp = false;
      // Honest directory fsync: on Windows directory fsync is unsupported by
      // the OS; we surface it as degraded durability rather than silently
      // claiming full durability.
      const dirSync = await fsyncDirectoryHonest(path.dirname(outputPath));
      if (!dirSync.synced && !dirSync.unsupported) {
        throw new WriteError(
          `Directory fsync failed for ${path.dirname(outputPath)} (platform=${dirSync.platform})`
        );
      }

      return {
        path: outputPath,
        width: info.width,
        height: info.height,
        format: normalizeSharpFormat(info.format) ?? plan.format,
        bytes: info.size
      };
    } catch (error) {
      if (wroteTemp) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
      }
      if (error instanceof DecodeError) {
        throw error;
      }
      if (error instanceof WriteError) {
        throw error;
      }
      // mkdir / rename / fsync failures are write-side.
      throw new WriteError(`Unable to produce image asset: ${outputPath}`, { cause: error });
    }
  }
}

function normalizeSharpFormat(format: string | undefined): ImageFormat | undefined {
  if (format === undefined) {
    return undefined;
  }
  return format === "jpeg" ? "jpg" : (format as ImageFormat);
}

function toSharpFormat(format: ImageFormat): "jpeg" | "png" | "webp" | "avif" {
  return format === "jpg" || format === "jpeg" ? "jpeg" : format;
}

async function fsyncFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, constants.O_RDONLY);
  try {
    await handle.sync();
  } catch (error) {
    // On Windows, fsync on some filesystems (e.g. temp dirs, network mounts)
    // fails with EPERM. This is a degraded-durability state, not a write
    // failure — the file was written successfully. We swallow EPERM/ENOTSUP
    // so produce does not abort after a successful encode. The atomic rename
    // still provides crash-safety; only fsync-durability is degraded.
    if (isNodeError(error) && ["EPERM", "ENOTSUP", "EINVAL"].includes(error.code ?? "")) {
      return;
    }
    throw error;
  } finally {
    await handle.close();
  }
}

/**
 * Atomic, no-overwrite finalization. Prefers `fs.link(temp, output)` because
 * hard link creation is atomic and fails with EEXIST when the target already
 * exists — there is no stat-then-rename TOCTOU window. After a successful
 * link, the temp inode is the output inode; unlink the temp name (the link
 * count drops but the file remains at `output`).
 *
 * If `link` is unavailable on the platform/path, falls back to the
 * stat-then-rename path (rejectExistingTarget + rename). That path is
 * best-effort: a foreign writer landing between the stat and rename would
 * still be clobbered, but that is a documented platform limitation.
 */
async function finalizeNoOverwrite(tempPath: string, outputPath: string): Promise<void> {
  try {
    await fs.link(tempPath, outputPath);
    // The link succeeded and the final entry exists at `outputPath`. Remove
    // the temp name; the file is now reachable only via `outputPath`.
    await fs.unlink(tempPath);
    return;
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      // A foreign writer (or a previous run) already created the target.
      // Refuse to clobber it.
      throw new WriteError(
        `Refusing to overwrite existing output target: ${outputPath} (atomic link finalization)`
      );
    }
    if (isNodeError(error) && ["ENOSYS", "EXDEV", "EPERM", "EACCES"].includes(error.code ?? "")) {
      // `link` not supported (cross-device, or fs without hardlinks). Fall
      // back to the documented stat-then-rename path.
      await rejectExistingTarget(outputPath);
      await fs.rename(tempPath, outputPath);
      return;
    }
    throw error;
  }
}

async function rejectExistingTarget(target: string): Promise<void> {
  try {
    await fs.stat(target);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new WriteError(
    `Refusing to overwrite existing output target: ${target} (exclusive finalization)`
  );
}

function isSharpDecodeError(error: unknown): boolean {
  if (error instanceof Error) {
    // sharp throws an Error with `name: "InputError"` or a message mentioning
    // "decode"/"input" for undecodable input. libvips errors carry the source
    // path or a "Vips" prefix.
    const name = (error as { name?: string }).name ?? "";
    const message = error.message ?? "";
    if (name === "InputError" || name === "VipsOperationError") {
      return true;
    }
    if (/decode|unsupported image|invalid input|no decoder|corrupt/i.test(message)) {
      return true;
    }
  }
  return false;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
