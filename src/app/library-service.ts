import fs from "node:fs/promises";
import path from "node:path";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import { SqliteIndex, type PickFilter } from "../adapters/sqlite-index.js";
import { SidecarStore } from "../adapters/sidecar-store.js";
import type { ImageOrientation } from "../domain/analysis-schema.js";
import {
  appendUsage,
  ensureIndexReady,
  listSidecars,
  stableNow,
  toPosixRel,
  validateExistingInput,
  type ServiceOutcome
} from "./runtime.js";

export async function listService(rootInput: string, filter: PickFilter): Promise<ServiceOutcome> {
  const root = path.resolve(rootInput);
  const sidecars = new SidecarStore(root);
  const index = new SqliteIndex(root);
  try {
    await ensureIndexReady(index, sidecars);
    return {
      result: successResult("list", { images: index.query(filter) }),
      exitCode: EXIT_CODES.SUCCESS
    };
  } finally {
    index.close();
  }
}

export async function statsService(rootInput: string): Promise<ServiceOutcome> {
  const root = path.resolve(rootInput);
  const sidecars = new SidecarStore(root);
  const index = new SqliteIndex(root);
  try {
    await ensureIndexReady(index, sidecars);
    const all = await listSidecars(sidecars);
    const thumbCount = await countFiles(path.join(root, ".img-ia", "thumbnails"));
    return {
      result: successResult(
        "stats",
        index.stats({ sidecarCount: all.length, thumbnailCount: thumbCount })
      ),
      exitCode: EXIT_CODES.SUCCESS
    };
  } finally {
    index.close();
  }
}

export async function markUsedService(
  rootInput: string,
  options: { sha?: string; path?: string; slot: string; location: string }
): Promise<ServiceOutcome> {
  const root = path.resolve(rootInput);
  const sidecars = new SidecarStore(root);
  const index = new SqliteIndex(root);
  try {
    await ensureIndexReady(index, sidecars);
    let sha = options.sha;
    if (sha === undefined && options.path !== undefined) {
      let abs: string;
      try {
        abs = await validateExistingInput(root, options.path);
      } catch {
        return notFound();
      }
      try {
        const stat = await fs.stat(abs);
        if (!stat.isFile()) return notFound();
      } catch {
        return notFound();
      }
      const rel = toPosixRel(root, abs);
      sha = index.query().find((record) => record.occurrences.includes(rel))?.sha256;
    }
    if (sha === undefined || index.findBySha(sha) === null) return notFound();
    const event = {
      sha256: sha,
      slot: options.slot,
      location: options.location,
      source: "mark-used" as const,
      at: stableNow()
    };
    await appendUsage(root, index, event);
    return {
      result: successResult("mark-used", { recorded: event }),
      exitCode: EXIT_CODES.SUCCESS
    };
  } finally {
    index.close();
  }
}

export type ListFilterInput = {
  category?: string;
  orientation?: ImageOrientation;
  minWidth?: number;
  minHeight?: number;
};
export function toPickFilter(input: ListFilterInput): PickFilter {
  const filter: PickFilter = {};
  if (input.category) filter.categories = [input.category];
  if (input.orientation) filter.orientation = input.orientation;
  if (input.minWidth) filter.minWidth = input.minWidth;
  if (input.minHeight) filter.minHeight = input.minHeight;
  return filter;
}
function notFound(): ServiceOutcome {
  return {
    result: errorResult(
      "mark-used",
      "not_found",
      "Image sha/path was not found as a live indexed occurrence"
    ),
    exitCode: EXIT_CODES.INVALID_INPUT
  };
}
async function countFiles(dir: string): Promise<number> {
  try {
    return (await fs.readdir(dir)).length;
  } catch {
    return 0;
  }
}
