import path from "node:path";

export const DEFAULT_GENERATED_DIRS = [".img-ia", "_out"] as const;
export const WINDOWS_MAX_PATH_BUDGET = 260 - 32;

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathEscapeError";
  }
}

export class PathBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathBudgetError";
  }
}

export function resolveInside(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(resolvedRoot, candidate);

  if (!isInsideOrSameDirectory(resolvedCandidate, resolvedRoot)) {
    throw new PathEscapeError(`Path escapes root: ${candidate}`);
  }

  return resolvedCandidate;
}

export function isInsideOrSameDirectory(candidate: string, directory: string): boolean {
  const normalizedDirectory = normalizeForComparison(path.resolve(directory));
  const normalizedCandidate = normalizeForComparison(path.resolve(candidate));
  const rel = path.relative(normalizedDirectory, normalizedCandidate);

  return isRelativeOperandInside(rel);
}

export function isGeneratedAssetPath(candidate: string, ignoredDirs: readonly string[]): boolean {
  return ignoredDirs.some((ignoredDir) =>
    shouldExcludeByGeneratedDirPredicate(candidate, ignoredDir)
  );
}

export function generatedDirsForRoot(
  root: string,
  configuredOutputDirs: readonly string[] = []
): string[] {
  const resolvedRoot = path.resolve(root);
  const configured = configuredOutputDirs.length > 0 ? configuredOutputDirs : ["_out"];
  const names = new Set<string>([...DEFAULT_GENERATED_DIRS, ...configured]);

  return [...names].map((dir) => resolveOutputDirInsideRoot(resolvedRoot, dir));
}

export function shouldExcludeByGeneratedDirPredicate(
  candidate: string,
  ignoredDir: string
): boolean {
  const resolvedCandidate = normalizeForComparison(path.resolve(candidate));
  const resolvedIgnoredDir = normalizeForComparison(path.resolve(ignoredDir));
  const rel = path.relative(resolvedIgnoredDir, resolvedCandidate);

  return isRelativeOperandInside(rel);
}

export function assertPathWithinBudget(
  projectedPath: string,
  budget = WINDOWS_MAX_PATH_BUDGET
): string {
  if (projectedPath.length > budget) {
    throw new PathBudgetError(
      `Projected path exceeds ${budget} characters: ${projectedPath.length}`
    );
  }

  return projectedPath;
}

/**
 * Validates that a configured generated-output directory is a root-relative
 * path that cannot escape the project root. Per design.md, `outputDirs[]` are
 * excluded from discovery/rebuild as generated output directories and MUST
 * stay confined under `--root`.
 *
 * Rejects:
 * - absolute paths (e.g. `C:\\_out`, `/_out`)
 * - empty segments (e.g. `a//b`, trailing slash only)
 * - `..` traversal segments (e.g. `../sibling`, `a/../../escape`)
 *
 * Accepts simple root-relative names/paths such as `_out`, `_out/nested`,
 * `.img-ia/cache`. Windows drive-relative prefixes (`C:_out`) are also rejected
 * since `path.resolve` on win32 treats `C:_out` as rooted on drive `C:`.
 *
 * @returns the normalized POSIX-style relative path (for stable comparison).
 * @throws PathEscapeError if the path is absolute or escapes the root.
 */
export function assertRootRelativeOutputDir(rawDir: string): string {
  if (rawDir.length === 0) {
    throw new PathEscapeError("outputDirs entry must not be empty");
  }

  if (path.isAbsolute(rawDir)) {
    throw new PathEscapeError(`outputDirs entry must be root-relative, got absolute: ${rawDir}`);
  }

  // Reject Windows drive-relative forms like "C:_out" or "C:foo" which
  // path.isAbsolute reports as false but path.resolve anchors to a drive root.
  if (/^[a-zA-Z]:/.test(rawDir)) {
    throw new PathEscapeError(
      `outputDirs entry must be root-relative, got drive-relative: ${rawDir}`
    );
  }

  // Inspect segments BEFORE normalizing, since path.posix.normalize collapses
  // empty segments (a//b -> a/b) and we want to reject them explicitly.
  const rawSegments = rawDir.replace(/\\/g, "/").split("/");
  for (const segment of rawSegments) {
    if (segment.length === 0) {
      throw new PathEscapeError(`outputDirs entry has empty segment: ${rawDir}`);
    }
    if (segment === "..") {
      throw new PathEscapeError(`outputDirs entry escapes root via '..': ${rawDir}`);
    }
  }

  const normalized = path.posix.normalize(rawDir.replace(/\\/g, "/"));

  if (normalized === ".." || normalized === ".") {
    throw new PathEscapeError(`outputDirs entry must not resolve to root/parent: ${rawDir}`);
  }

  // Re-check for '..' that normalization may have left at the front (e.g.
  // 'a/../../escape' normalizes to '../escape' and must be rejected).
  const normalizedSegments = normalized.split("/");
  for (const segment of normalizedSegments) {
    if (segment === "..") {
      throw new PathEscapeError(`outputDirs entry escapes root via '..': ${rawDir}`);
    }
  }

  return normalized;
}

/**
 * Resolves a root-relative output directory under `root` and asserts the
 * resolved path stays inside the root. Used by `generatedDirsForRoot` to
 * guarantee configured exclusions can never resolve outside `--root`.
 */
export function resolveOutputDirInsideRoot(root: string, rawDir: string): string {
  const normalized = assertRootRelativeOutputDir(rawDir);
  return resolveInside(root, normalized);
}

function isRelativeOperandInside(rel: string): boolean {
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../") && !path.isAbsolute(rel))
  );
}

function normalizeForComparison(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}
