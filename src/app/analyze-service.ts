import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { successResult } from "../cli/output.js";
import { SharpProcessor, WriteError, type ProbedImageInfo } from "../adapters/sharp-processor.js";
import { SqliteIndex } from "../adapters/sqlite-index.js";
import { SidecarStore, type SidecarSeed } from "../adapters/sidecar-store.js";
import { StorageRootGuard } from "../adapters/storage-root-guard.js";
import { redactErrorMessage } from "../adapters/secret-redactor.js";
import type { VisionProvider } from "../adapters/vision/provider.js";
import {
  assertPathWithinBudget,
  generatedDirsForRoot,
  isGeneratedAssetPath
} from "../domain/path-guard.js";
import { buildImageFileName, sanitizeSlug } from "../domain/slug-namer.js";
import { assertKnownCategories, primaryCategory, type Taxonomy } from "../domain/taxonomy.js";
import type { ImageAnalysis } from "../domain/analysis-schema.js";
import {
  extensionWithoutDot,
  readProjectConfig,
  sha256File,
  SUPPORTED_IMAGE_EXTENSIONS,
  toPosixRel,
  validateExistingInput,
  type ServiceOutcome
} from "./runtime.js";

export type AnalyzeOptions = { dryRun?: boolean; failFast?: boolean };

export type AnalyzeDeps = {
  provider: VisionProvider;
  image?: Pick<SharpProcessor, "probe" | "downscaleForVision">;
  index?: SqliteIndex;
  sidecars?: SidecarStore;
  taxonomy: Taxonomy;
};

type UniqueAnalysis = {
  analysis: ImageAnalysis;
  dims: ProbedImageInfo;
  model: string;
  cacheHit: boolean;
};

export async function analyzeService(
  rootInput: string,
  options: AnalyzeOptions,
  deps: AnalyzeDeps
): Promise<ServiceOutcome> {
  const root = path.resolve(rootInput);
  const image = deps.image ?? new SharpProcessor();
  const sidecars = deps.sidecars ?? new SidecarStore(root);
  const index = options.dryRun === true ? deps.index : (deps.index ?? new SqliteIndex(root));
  const ownIndex = deps.index === undefined && index !== undefined;
  const processed: unknown[] = [];
  const planned: unknown[] = [];
  const skipped: unknown[] = [];
  const analysisBySha = new Map<string, Promise<UniqueAnalysis>>();
  const reserved = new Set<string>();

  try {
    for await (const filePath of walkImages(root)) {
      try {
        const absolute = await validateExistingInput(root, filePath);
        const relBefore = toPosixRel(root, absolute);
        const sha256 = await sha256File(absolute);
        const unique = await getUniqueAnalysis(
          sha256,
          absolute,
          relBefore,
          image,
          sidecars,
          deps,
          analysisBySha
        );
        assertKnownCategories(deps.taxonomy, unique.analysis.categories);
        const existingSidecar = await sidecars.read(sha256);
        const destinationRel =
          existingSidecar?.occurrences.includes(relBefore) === true
            ? relBefore
            : await uniqueDestination(
                root,
                unique.analysis,
                sha256,
                extensionWithoutDot(absolute),
                reserved
              );
        const destinationAbs = path.join(root, destinationRel);
        const action = relBefore === destinationRel ? "index" : "move";

        if (options.dryRun === true) {
          planned.push({
            sha256,
            from: relBefore,
            to: destinationRel,
            category: primaryCategory(unique.analysis.categories),
            action,
            cacheHit: unique.cacheHit
          });
          continue;
        }

        const seed: SidecarSeed = {
          classification: unique.analysis,
          dims: { width: unique.dims.width, height: unique.dims.height },
          originalName: path.basename(relBefore),
          model: unique.model,
          canonicalRelPath: destinationRel
        };
        const updatedSidecar = await sidecars.mergeOccurrence(sha256, destinationRel, seed);
        if (relBefore !== destinationRel) {
          await new StorageRootGuard(root).ensureParentInside(destinationAbs);
          await fs.rename(absolute, destinationAbs);
        }
        index?.upsertContent({
          sha256,
          classification: updatedSidecar.classification,
          dims: updatedSidecar.dims,
          originalName: updatedSidecar.originalName,
          model: updatedSidecar.model,
          canonicalRelPath: updatedSidecar.canonicalRelPath,
          occurrences: updatedSidecar.occurrences,
          used: []
        });
        index?.upsertOccurrence(sha256, destinationRel, {
          primary: destinationRel === updatedSidecar.canonicalRelPath
        });
        processed.push({ sha256, from: relBefore, to: destinationRel, cacheHit: unique.cacheHit });
      } catch (error) {
        skipped.push({ path: toPosixRel(root, filePath), error: serializeAnalyzeError(error) });
        if (options.failFast === true) break;
      }
    }
  } catch (walkError) {
    // Errors from walkImages itself (fs.readdir, StorageRootGuard during
    // traversal, unreadable root) are converted into a batch-shaped skipped
    // entry so the run surfaces a filesystem/path exit 5 instead of a global
    // invalid_input exit 3. Dry-run still writes nothing.
    skipped.push({ path: toPosixRel(root, root), error: serializeAnalyzeError(walkError) });
  } finally {
    if (ownIndex) index?.close();
  }

  const status =
    skipped.length === 0
      ? "success"
      : processed.length > 0 || planned.length > 0
        ? "partial"
        : "failed";
  const result = successResult("analyze", { processed, planned, skipped });
  result.status = status;
  result.ok = status === "success";
  return {
    result,
    exitCode: status === "success" ? EXIT_CODES.SUCCESS : worstAnalyzeExit(skipped)
  };
}

async function getUniqueAnalysis(
  sha256: string,
  filePath: string,
  relPath: string,
  image: Pick<SharpProcessor, "probe" | "downscaleForVision">,
  sidecars: SidecarStore,
  deps: AnalyzeDeps,
  cache: Map<string, Promise<UniqueAnalysis>>
): Promise<UniqueAnalysis> {
  const existing = cache.get(sha256);
  if (existing) return existing;
  const promise = (async () => {
    const sidecar = await sidecars.read(sha256);
    if (sidecar !== null)
      return {
        analysis: sidecar.classification,
        dims: { width: sidecar.dims.width, height: sidecar.dims.height },
        model: sidecar.model,
        cacheHit: true
      };
    const dims = await image.probe(filePath);
    const imageBytes = await image.downscaleForVision(filePath, 1024);
    const analysis = await deps.provider.analyze({
      imageBytes,
      mimeType: mimeTypeFor(filePath),
      prompt: buildImageAnalysisPrompt(relPath, deps.taxonomy)
    });
    return { analysis, dims, model: deps.provider.id, cacheHit: false };
  })();
  cache.set(sha256, promise);
  return promise;
}

function buildImageAnalysisPrompt(relPath: string, taxonomy: Taxonomy): string {
  const categoryIds = taxonomy.categories.map((category) => category.id).join(", ");
  return [
    "Classify this image for a website image library.",
    `Existing path: ${relPath}`,
    "Return only valid JSON. Do not wrap it in markdown. Do not include commentary.",
    "The JSON object must match this exact schema:",
    '{"subject":"string","categories":["category-id"],"orientation":"landscape|portrait|square|panorama","altText":"string","title":"string","description":"string","suggestedSlug":"lowercase-kebab-case"}',
    `Allowed category ids: ${categoryIds}`,
    "Use one or more allowed category ids only. If no category fits, use uncategorized."
  ].join("\n");
}

async function uniqueDestination(
  root: string,
  analysis: ImageAnalysis,
  sha256: string,
  extension: string,
  reserved: Set<string>
): Promise<string> {
  const category = sanitizeSlug(primaryCategory(analysis.categories));
  for (let sequence = 1; sequence < 10_000; sequence += 1) {
    const name = buildImageFileName({
      suggestedSlug: analysis.suggestedSlug,
      sequence,
      sha256,
      extension,
      collision: sequence > 1
    });
    const rel = `${category}/${name}`;
    assertPathWithinBudget(path.join(root, rel));
    if (!reserved.has(rel) && !(await exists(path.join(root, rel)))) {
      reserved.add(rel);
      return rel;
    }
  }
  throw new WriteError(`Unable to allocate unique destination for ${sha256}`);
}

async function* walkImages(root: string): AsyncGenerator<string> {
  const config = await readProjectConfig(root);
  const ignored = generatedDirsForRoot(root, config.outputDirs);
  const guard = new StorageRootGuard(root);
  const visited = new Set<string>();

  async function* walk(dir: string, isRoot: boolean): AsyncGenerator<string> {
    if (isGeneratedAssetPath(dir, ignored)) return;
    const realDir = await guard.ensureInside(dir, true);
    if (visited.has(realDir)) return;
    visited.add(realDir);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (readError) {
      // A per-directory read failure (unreadable subdir, broken symlink
      // target) must not abort the whole traversal. Skip this directory and
      // let the caller continue with sibling directories. The root-level read
      // failure is allowed to propagate so the caller surfaces a skipped
      // entry and a filesystem/partial exit rather than a silent empty
      // success.
      if (isRoot) throw readError;
      return;
    }
    for (const entry of entries) {
      const candidate = path.join(dir, entry.name);
      if (isGeneratedAssetPath(candidate, ignored)) continue;
      try {
        if (entry.isDirectory()) {
          yield* walk(candidate, false);
          continue;
        }
        if (entry.isSymbolicLink()) {
          await guard.ensureInside(candidate, true);
          const stat = await fs.stat(candidate);
          if (stat.isDirectory()) {
            yield* walk(candidate, false);
            continue;
          }
          if (
            stat.isFile() &&
            SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
          )
            yield candidate;
          continue;
        }
        if (
          entry.isFile() &&
          SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        )
          yield candidate;
      } catch {
        // A per-entry path/read failure (broken symlink, unreadable file stat)
        // must not abort traversal. Skip the bad entry and continue with the
        // remaining files so valid images after it are still discovered.
        continue;
      }
    }
  }
  yield* walk(root, true);
}

function mimeTypeFor(filePath: string): string {
  const ext = extensionWithoutDot(filePath);
  return ext === "jpg" ? "image/jpeg" : `image/${ext}`;
}
async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
function serializeAnalyzeError(error: unknown): { type: string; message: string } {
  return {
    type: error instanceof Error ? error.name : "Error",
    message: redactErrorMessage(error)
  };
}
function worstAnalyzeExit(skipped: unknown[]): number {
  return skipped.some((item) => {
    if (item === null || typeof item !== "object" || !("error" in item)) return false;
    const errorType = (item as { error?: { type?: string } }).error?.type;
    return typeof errorType === "string" && errorType.endsWith("ProviderError");
  })
    ? EXIT_CODES.PROVIDER_ERROR
    : EXIT_CODES.FILESYSTEM_ERROR;
}
