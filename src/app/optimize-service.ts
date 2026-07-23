import fs from "node:fs/promises";
import path from "node:path";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import { SharpProcessor } from "../adapters/sharp-processor.js";
import { ExiftoolMetadata } from "../adapters/exiftool-metadata.js";
import { StorageRootGuard } from "../adapters/storage-root-guard.js";
import { planResize, type ImageFormat, type ResizeTarget } from "../domain/resize-planner.js";
import { sanitizeSlug } from "../domain/slug-namer.js";
import { extensionWithoutDot, validateExistingInput, type ServiceOutcome } from "./runtime.js";

export type OptimizeOptions = Omit<ResizeTarget, "format"> & { format?: ImageFormat };

export async function optimizeService(
  rootInput: string,
  source: string,
  options: OptimizeOptions
): Promise<ServiceOutcome> {
  const root = path.resolve(rootInput);
  const input = await validateExistingInput(root, source);
  const guard = new StorageRootGuard(root);
  const processor = new SharpProcessor(guard);
  const metadata = new ExiftoolMetadata();
  const info = await processor.probe(input);
  const format = options.format ?? info.format ?? (extensionWithoutDot(source) as ImageFormat);
  const target: ResizeTarget = { ...options, format };
  const plan = planResize(info, target);
  if (!plan.ok) {
    return {
      result: errorResult("optimize", plan.reason, "Requested output exceeds source dimensions", {
        source: plan.source,
        requested: plan.requested
      }),
      exitCode: EXIT_CODES.INVALID_INPUT
    };
  }

  const tags = plan.keepMetadata ? await metadata.read(input) : undefined;
  const output = await uniqueOutput(root, source, plan.format);
  const asset = await processor.produce(input, output, { ...plan, keepMetadata: false });
  if (tags !== undefined) await metadata.reapplyTags(asset.path, tags);
  return {
    result: successResult("optimize", {
      asset: { ...asset, relPath: path.relative(root, asset.path).split(path.sep).join("/") }
    }),
    exitCode: EXIT_CODES.SUCCESS
  };
}

async function uniqueOutput(root: string, source: string, format: ImageFormat): Promise<string> {
  const base = sanitizeSlug(path.basename(source, path.extname(source)));
  for (let i = 1; i < 10_000; i += 1) {
    const suffix = i === 1 ? "" : `-${String(i).padStart(3, "0")}`;
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
  throw new Error("Unable to allocate output path");
}
