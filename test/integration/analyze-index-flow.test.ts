import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeService } from "../../src/app/analyze-service.js";
import { listService } from "../../src/app/library-service.js";
import { SqliteIndex } from "../../src/adapters/sqlite-index.js";
import { SidecarStore, type Sidecar } from "../../src/adapters/sidecar-store.js";
import type { VisionProvider } from "../../src/adapters/vision/provider.js";
import type { Taxonomy } from "../../src/domain/taxonomy.js";
import { rmWithRetry } from "../support/cleanup.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rmWithRetry(root)));
  roots.length = 0;
});

describe("Phase 4 analyze/index integration", () => {
  it("recursively discovers supported images and ignores non-images plus generated output", async () => {
    const root = await tempRoot();
    await writeImage(root, "nested/a.jpg", 640, 320);
    await writeImage(root, "nested/deeper/b.png", 320, 320);
    await fs.writeFile(path.join(root, "nested", "notes.txt"), "not an image");
    await writeImage(root, "_out/generated.jpg", 640, 320);
    await writeImage(root, "_outdoor/not-generated.jpg", 640, 320);
    const provider = fakeProvider();

    const outcome = await analyzeService(
      root,
      { dryRun: true },
      { provider, image: fakeImage(), taxonomy }
    );

    expect(outcome.exitCode).toBe(0);
    const details = outcome.result.details as { planned: Array<{ from: string }> };
    expect(details.planned.map((p) => p.from).sort()).toEqual([
      "_outdoor/not-generated.jpg",
      "nested/a.jpg",
      "nested/deeper/b.png"
    ]);
  });

  it("collapses duplicates before AI, persists one sidecar, and reuses cache on the second run", async () => {
    const root = await tempRoot();
    const image = await sharp({ create: { width: 200, height: 100, channels: 3, background: "blue" } })
      .jpeg()
      .toBuffer();
    await fs.writeFile(path.join(root, "a.jpg"), image);
    await fs.writeFile(path.join(root, "b.jpg"), image);
    const firstProvider = fakeProvider();

    const first = await analyzeService(root, {}, { provider: firstProvider, image: fakeImage(), taxonomy });

    expect(first.exitCode).toBe(0);
    expect(firstProvider.calls).toBe(1);
    const sidecarFiles = await fs.readdir(path.join(root, ".img-ia", "sidecars"));
    expect(sidecarFiles).toHaveLength(1);
    const sha = sidecarFiles[0]!.replace(/\.json$/, "");
    const sidecar = await new SidecarStore(root).read(sha);
    expect(sidecar?.classification.title).toBe("Kitchen");
    expect(sidecar?.occurrences).toHaveLength(2);

    const secondProvider = fakeProvider();
    const second = await analyzeService(root, {}, { provider: secondProvider, image: fakeImage(), taxonomy });

    expect(second.exitCode).toBe(0);
    expect(secondProvider.calls).toBe(0);
  });

  it("persists queryable SQLite index rows after analyze, not only sidecars/cache", async () => {
    // A non-dry-run analyze MUST populate the SQLite index (content + occurrence
    // rows) so subsequent `list`/`stats`/`pick` reads are queryable without a
    // rebuild. Asserting only sidecars exist would miss a regression where
    // analyze writes sidecars but forgets to upsert the index.
    const root = await tempRoot();
    await writeImage(root, "kitchen/kitchen-001.jpg", 200, 100);
    const provider = fakeProvider();

    const outcome = await analyzeService(root, {}, { provider, image: fakeImage(), taxonomy });

    expect(outcome.exitCode).toBe(0);
    const index = new SqliteIndex(root);
    try {
      // Query the index directly. analyze upserts content + occurrence rows
      // directly (not via rebuildFromSidecars), so the rebuild sentinel may
      // be null even though the rows are present and queryable. The contract
      // under test is "rows are queryable", not "sentinel is completed".
      const records = index.query();
      expect(records).toHaveLength(1);
      const record = records[0]!;
      expect(record.classification.categories).toContain("kitchen-remodeling");
      // The injected fake image probe reports 1200x800 (see fakeImage), so the
      // index stores those dimensions rather than the real 200x100 file size.
      expect(record.dims).toEqual({ width: 1200, height: 800 });
      expect(record.occurrences.length).toBeGreaterThanOrEqual(1);
      // The occurrence row must be live and queryable.
      expect(record.occurrences.some((occ) => occ.endsWith("kitchen-001.jpg"))).toBe(true);
    } finally {
      index.close();
    }
  });

  it("rebuilds the queryable database after the SQLite file is lost", async () => {
    const root = await tempRoot();
    const { sidecar } = await rootWithSidecarOnly(root);
    const index = new SqliteIndex(root);
    await index.rebuildFromSidecars([sidecar]);
    index.close();
    await fs.rm(path.join(root, ".img-ia", "index.sqlite"), { force: true });

    const outcome = await listService(root, { categories: ["kitchen-remodeling"] });

    expect(outcome.exitCode).toBe(0);
    const details = outcome.result.details as { images: Array<{ sha256: string }> };
    expect(details.images).toHaveLength(1);
    const rebuilt = new SqliteIndex(root);
    expect(rebuilt.rebuildStatus()).toBe("completed");
    rebuilt.close();
  });
});

async function rootWithSidecarOnly(root: string): Promise<{ sidecar: Sidecar }> {
  const rel = "kitchen/kitchen-001.jpg";
  await writeImage(root, rel, 200, 100);
  const bytes = await fs.readFile(path.join(root, rel));
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  const sidecar: Sidecar = {
    sha256: sha,
    classification: analysis,
    dims: { width: 200, height: 100 },
    originalName: "kitchen.jpg",
    model: "test",
    canonicalRelPath: rel,
    occurrences: [rel],
    primaryFlag: "canonicalRelPath"
  };
  await fs.mkdir(path.join(root, ".img-ia", "sidecars"), { recursive: true });
  await fs.writeFile(path.join(root, ".img-ia", "sidecars", `${sha}.json`), `${JSON.stringify(sidecar)}\n`);
  return { sidecar };
}

async function writeImage(root: string, rel: string, width: number, height: number): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: "white" } }).jpeg().toFile(file);
}

function fakeProvider(): VisionProvider & { calls: number } {
  return {
    id: "fake-model",
    calls: 0,
    async analyze() {
      this.calls += 1;
      return analysis;
    }
  };
}

function fakeImage() {
  return {
    async probe() {
      return { width: 1200, height: 800, format: "jpg" as const };
    },
    async downscaleForVision() {
      return Buffer.from("vision");
    }
  };
}

const analysis = {
  subject: "Kitchen",
  categories: ["kitchen-remodeling"],
  orientation: "landscape" as const,
  altText: "Kitchen remodel",
  title: "Kitchen",
  description: "Kitchen remodel photo",
  suggestedSlug: "Kitchen"
};

const taxonomy: Taxonomy = {
  version: 1,
  categories: [{ id: "kitchen-remodeling", label: "Kitchen Remodeling", aliases: [] }]
};

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-integration-"));
  roots.push(root);
  return root;
}