import fs from "node:fs/promises";

/**
 * Retries a recursive directory removal when the OS reports a transient
 * lock/permission error. On Windows, files just written by sharp/exiftool/
 * better-sqlite3 can still be held briefly by the OS or an antivirus scan,
 * causing `fs.rm` to fail with EBUSY, EPERM, or ENOTEMPTY. Retrying with a
 * short backoff makes test teardown deterministic across platforms without
 * masking genuine filesystem failures.
 */
export async function rmWithRetry(target: string, attempts = 5): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts - 1 || !isRetryableCleanupError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

/**
 * Windows can briefly hold a handle on freshly written files, surfacing as
 * EBUSY (file in use), EPERM (permission/lock), or ENOTEMPTY (directory still
 * has entries being released). All three are transient for test teardown.
 */
export function isRetryableCleanupError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: string }).code;
  return code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
}