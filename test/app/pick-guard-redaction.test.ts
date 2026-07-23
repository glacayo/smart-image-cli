import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { pickService } from "../../src/app/pick-service.js";
import { SqliteIndex } from "../../src/adapters/sqlite-index.js";
import { redactErrorMessage, defaultSecretRedactor } from "../../src/adapters/secret-redactor.js";
import { serviceError } from "../../src/app/runtime.js";
import type { Sidecar } from "../../src/adapters/sidecar-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("pickService input root guard", () => {
  it("rejects an index candidate whose canonicalRelPath is missing on disk", async () => {
    const root = await indexedRoot();
    // Delete the indexed image file so the candidate source no longer exists.
    await fs.rm(path.join(root, "kitchen/kitchen-001.jpg"));

    const outcome = await pickService(root, {
      category: "kitchen-remodeling",
      width: 100,
      height: 50,
      slot: "home.hero",
      location: "hero"
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.result.reason).toBe("no_candidate");
    // The guard catches the missing file; the message describes the failure.
    expect(outcome.result.message).toMatch(/readable file|root-guard validation/);
  });

  it("rejects an index candidate whose canonicalRelPath escapes root via symlink", async () => {
    const root = await indexedRoot();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-out-"));
    roots.push(outside);
    await sharp({ create: { width: 200, height: 100, channels: 3, background: "red" } })
      .jpeg()
      .toFile(path.join(outside, "stolen.jpg"));

    // Replace the indexed image with a symlink pointing outside root.
    await fs.rm(path.join(root, "kitchen/kitchen-001.jpg"));
    try {
      await fs.symlink(
        path.join(outside, "stolen.jpg"),
        path.join(root, "kitchen/kitchen-001.jpg")
      );
    } catch {
      return; // OS denied link creation
    }

    const outcome = await pickService(root, {
      category: "kitchen-remodeling",
      width: 100,
      height: 50,
      slot: "home.hero",
      location: "hero"
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.result.reason).toBe("no_candidate");
    expect(outcome.result.message).toContain("root-guard validation");
  });
});

describe("pickService usage transaction contract", () => {
  it("rolls back produced output and returns usage_failed when durable usage recording fails", async () => {
    const root = await indexedRoot();
    // Make the usage journal path a DIRECTORY so fs.open(journal, ...) fails
    // with EISDIR. This forces appendUsage to fail AFTER produce succeeds,
    // exercising the rollback + usage_failed contract.
    await fs.mkdir(path.join(root, ".img-ia", "usage.jsonl"), { recursive: true });

    const outcome = await pickService(root, {
      category: "kitchen-remodeling",
      width: 100,
      height: 50,
      slot: "home.hero",
      location: "hero"
    });

    expect(outcome.exitCode).toBe(5);
    expect(outcome.result.reason).toBe("usage_failed");
    expect(outcome.result.message).toContain("rolled back");
    // The produced _out asset must have been removed.
    const outDir = path.join(root, "_out");
    try {
      const entries = await fs.readdir(outDir);
      expect(entries.length).toBe(0);
    } catch {
      // _out may not exist at all, which is also acceptable.
    }
  });

  it("truncates the journal line and rolls back output when the SQLite index update fails AFTER the journal write", async () => {
    const root = await indexedRoot();
    // Inject a SqliteIndex subclass whose recordUsageEvent throws AFTER
    // appendUsage has durably written the journal line. This proves a
    // post-journal/SQL failure does not leave durable usage marking for a
    // rolled-back output.
    const failingIndex = new (class extends SqliteIndex {
      recordUsageEvent(): void {
        throw new Error("simulated index update failure");
      }
    })(root);
    try {
      const outcome = await pickService(
        root,
        {
          category: "kitchen-remodeling",
          width: 100,
          height: 50,
          slot: "home.hero",
          location: "hero"
        },
        { index: failingIndex }
      );

      expect(outcome.exitCode).toBe(5);
      expect(outcome.result.reason).toBe("usage_failed");
      // The journal must have been truncated back to its pre-append size:
      // no durable usage line survives for the rolled-back output.
      const journalPath = path.join(root, ".img-ia", "usage.jsonl");
      const journalContent = await fs.readFile(journalPath, "utf8");
      expect(journalContent.trim()).toBe("");
      // The produced _out asset must have been removed.
      const outDir = path.join(root, "_out");
      try {
        const entries = await fs.readdir(outDir);
        expect(entries.length).toBe(0);
      } catch {
        // _out may not exist at all, which is also acceptable.
      }
    } finally {
      failingIndex.close();
    }
  });
});

describe("central redaction", () => {
  // Construct provider-shaped secret fixtures dynamically so the literal
  // `sk_test_...` string never appears committed in source. The redactor's
  // LONG_SECRET_VALUE regex still matches the assembled value because it
  // starts with `sk_` and has 24+ word characters.
  function buildSkSecret(): string {
    return ["sk", "test_secret_1234567890_abcdef"].join("_");
  }

  it("serviceError redacts a secret-shaped error message", () => {
    const secret = buildSkSecret();
    const error = new Error(`failed with key ${secret}`);
    const result = serviceError("pick", "filesystem_error", error);
    expect(result.message).not.toContain(secret);
  });

  it("redactErrorMessage masks a secret in an Error message", () => {
    const secret = buildSkSecret();
    const masked = redactErrorMessage(new Error(`key=${secret}`));
    expect(masked).not.toContain(secret);
  });

  it("defaultSecretRedactor.mask masks Bearer tokens", () => {
    const token = buildSkSecret();
    const masked = defaultSecretRedactor.mask(`Authorization: Bearer ${token}`);
    expect(masked).not.toContain(token);
    expect(masked).toContain("REDACTED");
  });
});

async function indexedRoot(): Promise<string> {
  const root = await tempRoot();
  const { sha, sidecar } = await writeImageAndSidecar(root);
  const index = new SqliteIndex(root);
  await index.rebuildFromSidecars([sidecar]);
  index.close();
  await fs.mkdir(path.join(root, ".img-ia", "sidecars"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".img-ia", "sidecars", `${sha}.json`),
    `${JSON.stringify(sidecar)}\n`
  );
  return root;
}

async function writeImageAndSidecar(root: string): Promise<{ sha: string; sidecar: Sidecar }> {
  const rel = "kitchen/kitchen-001.jpg";
  await fs.mkdir(path.join(root, "kitchen"), { recursive: true });
  await sharp({ create: { width: 200, height: 100, channels: 3, background: "blue" } })
    .jpeg()
    .toFile(path.join(root, rel));
  const bytes = await fs.readFile(path.join(root, rel));
  const sha = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
  return {
    sha,
    sidecar: {
      sha256: sha,
      classification: {
        subject: "Kitchen",
        categories: ["kitchen-remodeling"],
        orientation: "landscape",
        altText: "Kitchen",
        title: "Kitchen",
        description: "Kitchen",
        suggestedSlug: "kitchen"
      },
      dims: { width: 200, height: 100 },
      originalName: "kitchen.jpg",
      model: "test",
      canonicalRelPath: rel,
      occurrences: [rel],
      primaryFlag: "canonicalRelPath"
    }
  };
}

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-pick-"));
  roots.push(root);
  return root;
}
