import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { optimizeService } from "../../src/app/optimize-service.js";
import { pickService } from "../../src/app/pick-service.js";
import { listService, markUsedService } from "../../src/app/library-service.js";
import { SqliteIndex } from "../../src/adapters/sqlite-index.js";
import type { Sidecar } from "../../src/adapters/sidecar-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("Phase 3 app services", () => {
  it("optimize refuses to upscale before writing _out assets", async () => {
    const root = await tempRoot();
    await sharp({ create: { width: 100, height: 50, channels: 3, background: "red" } })
      .jpeg()
      .toFile(path.join(root, "small.jpg"));

    const outcome = await optimizeService(root, "small.jpg", { width: 200, format: "webp" });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("target_exceeds_source");
    await expect(fs.stat(path.join(root, "_out"))).rejects.toThrow();
  });

  it("pick returns no_candidate with alternatives for undersized matches", async () => {
    const root = await indexedRoot();

    const outcome = await pickService(root, {
      category: "kitchen-remodeling",
      width: 300,
      height: 200,
      slot: "home.hero",
      location: "hero"
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.result.reason).toBe("no_candidate");
    expect(JSON.stringify(outcome.result.details)).toContain("width_deficit");
  });

  it("pick records usage before returning a success manifest", async () => {
    const root = await indexedRoot();

    const outcome = await pickService(root, {
      category: "kitchen-remodeling",
      width: 100,
      height: 50,
      slot: "home.hero",
      location: "hero"
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result.ok).toBe(true);
    await expect(fs.readFile(path.join(root, ".img-ia", "usage.jsonl"), "utf8")).resolves.toContain(
      "home.hero"
    );
  });

  it("mark-used --path applies path safety before missing-path lookup", async () => {
    const root = await indexedRoot();

    const outcome = await markUsedService(root, {
      path: "../outside.jpg",
      slot: "home.hero",
      location: "hero"
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("not_found");
  });

  it("list rebuilds the derived index from sidecars when no rebuild completed yet", async () => {
    const root = await rootWithSidecarOnly();

    const outcome = await listService(root, {});

    expect(outcome.exitCode).toBe(0);
    expect(JSON.stringify(outcome.result.details)).toContain("kitchen-remodeling");
    const index = new SqliteIndex(root);
    expect(index.rebuildStatus()).toBe("completed");
    index.close();
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

async function rootWithSidecarOnly(): Promise<string> {
  const root = await tempRoot();
  const { sha, sidecar } = await writeImageAndSidecar(root);
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-phase3-"));
  roots.push(root);
  return root;
}
