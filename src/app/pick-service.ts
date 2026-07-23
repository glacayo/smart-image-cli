import fs from "node:fs/promises";
import path from "node:path";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import { SqliteIndex } from "../adapters/sqlite-index.js";
import { SidecarStore } from "../adapters/sidecar-store.js";
import { SharpProcessor } from "../adapters/sharp-processor.js";
import { StorageRootGuard } from "../adapters/storage-root-guard.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import { planResize, type ImageFormat } from "../domain/resize-planner.js";
import { matchSlot, type SlotRequest } from "../domain/slot-matcher.js";
import { sanitizeSlug } from "../domain/slug-namer.js";
import { appendUsage, ensureIndexReady, stableNow, type ServiceOutcome } from "./runtime.js";

export type PickOptions = SlotRequest & { format?: ImageFormat };

export type PickDeps = {
  /** Inject an alternate index (e.g. a failing/stub for tests). When omitted, a fresh `SqliteIndex(root)` is created and owned by the service. */
  index?: SqliteIndex;
};

export async function pickService(
  rootInput: string,
  options: PickOptions,
  deps: PickDeps = {}
): Promise<ServiceOutcome> {
  const root = path.resolve(rootInput);
  const sidecars = new SidecarStore(root);
  const injectedIndex = deps.index;
  const index = injectedIndex ?? new SqliteIndex(root);
  const ownIndex = injectedIndex === undefined;
  try {
    await ensureIndexReady(index, sidecars);
    const records = index.query();
    const match = matchSlot(
      records.map((r) => ({
        sha256: r.sha256,
        canonicalRelPath: r.canonicalRelPath,
        categories: r.classification.categories,
        orientation: r.classification.orientation,
        dims: r.dims,
        used: r.used
      })),
      options
    );
    if (!match.ok)
      return {
        result: errorResult(
          "pick",
          "no_candidate",
          "No indexed image satisfies the requested slot constraints",
          { alternatives: match.alternatives }
        ),
        exitCode: EXIT_CODES.NO_MATCH
      };
    const candidate = records.find((r) => r.sha256 === match.candidate.sha256)!;
    const format = options.format ?? "jpg";
    const resizeTarget = {
      format,
      mode: options.width && options.height ? ("crop" as const) : ("resize" as const)
    };
    if (options.width !== undefined) Object.assign(resizeTarget, { width: options.width });
    if (options.height !== undefined) Object.assign(resizeTarget, { height: options.height });
    const plan = planResize(candidate.dims, resizeTarget);
    if (!plan.ok)
      return {
        result: errorResult(
          "pick",
          "no_candidate",
          "Candidate cannot satisfy request without upscaling",
          { cause: plan.reason, alternatives: match.alternatives }
        ),
        exitCode: EXIT_CODES.NO_MATCH
      };
    const guard = new StorageRootGuard(root);
    // The index-derived canonicalRelPath is trusted storage, not user input, but
    // a corrupted/tampered sidecar could still point a symlink/junction escape
    // outside root. Validate the source through the guard (realpath + containment)
    // and reject missing/escaped sources with a typed safe error BEFORE produce.
    const source = path.join(root, candidate.canonicalRelPath);
    let validatedSource: string;
    try {
      validatedSource = await guard.ensureInside(source, true);
      const stat = await fs.stat(validatedSource);
      if (!stat.isFile()) {
        return {
          result: errorResult("pick", "no_candidate", "Indexed candidate is not a readable file", {
            canonicalRelPath: candidate.canonicalRelPath
          }),
          exitCode: EXIT_CODES.NO_MATCH
        };
      }
    } catch (error) {
      return {
        result: errorResult(
          "pick",
          "no_candidate",
          "Indexed candidate source failed root-guard validation",
          {
            canonicalRelPath: candidate.canonicalRelPath,
            error:
              error instanceof Error
                ? defaultSecretRedactor.mask(error.message)
                : defaultSecretRedactor.mask(String(error))
          }
        ),
        exitCode: EXIT_CODES.NO_MATCH
      };
    }
    const output = await uniquePickOutput(root, options, candidate.sha256, format);
    const processor = new SharpProcessor(guard);
    const asset = await processor.produce(validatedSource, output, plan);
    const usage = {
      sha256: candidate.sha256,
      slot: options.slot ?? "default",
      location: options.location ?? asset.path,
      source: "pick" as const,
      at: stableNow()
    };
    try {
      await appendUsage(root, index, usage);
    } catch (usageError) {
      // The produced _out asset is not safely usable without a durable usage
      // record. Roll back the produced output and return a structured
      // `usage_failed` result so callers get an actionable reason instead of a
      // generic filesystem_error. appendUsage truncates the journal line when
      // the SQLite index update fails AFTER the journal is durably written, so
      // no durable usage marking survives a rolled-back pick.
      await fs.rm(asset.path, { force: true }).catch(() => undefined);
      return {
        result: errorResult(
          "pick",
          "usage_failed",
          "Produced output was rolled back because durable usage recording failed",
          {
            sha256: candidate.sha256,
            output: path.relative(root, asset.path).split(path.sep).join("/"),
            error: defaultSecretRedactor.mask(
              usageError instanceof Error ? usageError.message : String(usageError)
            )
          }
        ),
        exitCode: EXIT_CODES.FILESYSTEM_ERROR
      };
    }
    return {
      result: successResult("pick", {
        manifest: {
          sha256: candidate.sha256,
          source: candidate.canonicalRelPath,
          output: path.relative(root, asset.path).split(path.sep).join("/"),
          width: asset.width,
          height: asset.height,
          format: asset.format,
          usage
        }
      }),
      exitCode: EXIT_CODES.SUCCESS
    };
  } finally {
    if (ownIndex) index.close();
  }
}

async function uniquePickOutput(
  root: string,
  options: PickOptions,
  sha256: string,
  format: ImageFormat
): Promise<string> {
  const base = sanitizeSlug(
    `${options.slot ?? "slot"}-${options.location ?? "asset"}-${sha256.slice(0, 8)}`
  );
  for (let i = 1; i < 10_000; i += 1) {
    const suffix = i === 1 ? "" : `-${i}`;
    const candidate = path.join(
      root,
      "_out",
      `${base}${suffix}.${format === "jpeg" ? "jpg" : format}`
    );
    try {
      await fs.stat(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error("Unable to allocate pick output path");
}
