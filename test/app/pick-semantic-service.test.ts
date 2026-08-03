import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickService } from "../../src/app/pick-service.js";
import { SqliteIndex } from "../../src/adapters/sqlite-index.js";
import {
  RateLimitProviderError,
  VisionProviderError,
  type RankingCandidateMeta
} from "../../src/adapters/vision/provider.js";
import type { Sidecar } from "../../src/adapters/sidecar-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("pickService semantic ranking", () => {
  it("defaults query ranking to the local ranker and emits a ranking block", async () => {
    const root = await indexedRoot([
      imageFixture("a-dark.jpg", "Dark sink", "Bathroom", "shadow vanity", "bathroom"),
      imageFixture("b-bright.jpg", "Bright shower", "Bathroom", "bright shower", "bathroom")
    ]);

    const outcome = await pickService(root, {
      category: "bathroom",
      width: 100,
      height: 50,
      query: "bright shower",
      topK: 1
    });

    expect(outcome.exitCode).toBe(0);
    const manifest = successManifest(outcome.result.details);
    expect(manifest.source).toBe("b-bright.jpg");
    expect(manifest.ranking).toMatchObject({
      status: "ranked",
      mode: "local",
      query: "bright shower",
      topK: 1
    });
    expect(manifest.ranking.reason).toContain("bright");
    expect(manifest.ranking.alternatives).toHaveLength(1);
    const usageLines = (await fs.readFile(path.join(root, ".img-ia", "usage.jsonl"), "utf8"))
      .trim()
      .split("\n");
    expect(usageLines).toHaveLength(1);
    expect(usageLines[0]).toContain('"source":"pick"');
  });

  it("semantic ai ranks eligible candidates with metadata only", async () => {
    const root = await indexedRoot([
      imageFixture("a-sink.jpg", "Sink", "Bathroom", "small sink", "bathroom"),
      imageFixture("b-shower.jpg", "Shower", "Bathroom", "large bright shower", "bathroom")
    ]);
    const rank = vi.fn(async (_query: string, candidates: readonly RankingCandidateMeta[]) => [
      { sha256: candidates[1]!.sha256, score: 0.95, reason: "best semantic match" },
      { sha256: candidates[0]!.sha256, score: 0.4, reason: "weaker match" }
    ]);

    const outcome = await pickService(
      root,
      { category: "bathroom", query: "bright shower", semantic: "ai" },
      { textRanker: { id: "ai", rank } }
    );

    expect(outcome.exitCode).toBe(0);
    expect(rank).toHaveBeenCalledOnce();
    const [, candidates] = rank.mock.calls[0]!;
    expect(JSON.stringify(candidates)).not.toContain(".jpg");
    expect(JSON.stringify(candidates)).not.toContain("imageBytes");
    expect(candidates.map((candidate) => candidate.title)).toEqual(["Sink", "Shower"]);
    expect(successManifest(outcome.result.details).ranking).toMatchObject({
      status: "ranked",
      mode: "ai",
      reason: "best semantic match",
      score: 0.95
    });
    const usageLines = (await fs.readFile(path.join(root, ".img-ia", "usage.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { source: string });
    expect(usageLines).toEqual([expect.objectContaining({ source: "pick" })]);
  });

  it("redacts and bounds the semantic query in structured ranking output", async () => {
    const root = await indexedRoot([
      imageFixture("a-bath.jpg", "Bath", "Bathroom", "quiet bath", "bathroom")
    ]);
    const rawSecretQuery = `find bath with api_key=sk-${"a".repeat(80)} ${"extra ".repeat(40)}`;

    const outcome = await pickService(root, { category: "bathroom", query: rawSecretQuery });

    expect(outcome.exitCode).toBe(0);
    const query = successManifest(outcome.result.details).ranking?.query;
    expect(query).toBeDefined();
    expect(query).not.toContain(rawSecretQuery);
    expect(query).not.toContain(`sk-${"a".repeat(80)}`);
    expect(query!.length).toBeLessThanOrEqual(160);
  });

  it("maps AI ranker failures to ai_ranking_failed without local fallback", async () => {
    const root = await indexedRoot([
      imageFixture("a-sink.jpg", "Sink", "Bathroom", "small sink", "bathroom")
    ]);
    const rank = vi.fn(async () => {
      throw new RateLimitProviderError("provider rate limited ranking");
    });

    const outcome = await pickService(
      root,
      { category: "bathroom", query: "sink", semantic: "ai" },
      { textRanker: { id: "ai", rank } }
    );

    expect(outcome.exitCode).toBe(4);
    expect(outcome.result.reason).toBe("ai_ranking_failed");
    expect(rank).toHaveBeenCalledOnce();
    await expect(fs.stat(path.join(root, "_out"))).rejects.toThrow();
    await expect(fs.stat(path.join(root, ".img-ia", "usage.jsonl"))).rejects.toThrow();
  });

  it("redacts provider failure details at the pick-service boundary", async () => {
    const root = await indexedRoot([
      imageFixture("a-sink.jpg", "Sink", "Bathroom", "small sink", "bathroom")
    ]);
    const leakedToken = `sk-${"b".repeat(40)}`;
    const rank = vi.fn(async () => {
      throw new VisionProviderError("MalformedOutput", `provider leaked ${leakedToken}`, {
        apiKey: leakedToken,
        nested: { authorization: `Bearer ${leakedToken}` },
        url: `https://provider.example/v1?api_key=${leakedToken}`
      });
    });

    const outcome = await pickService(
      root,
      { category: "bathroom", query: "sink", semantic: "ai" },
      { textRanker: { id: "future-ai", rank } }
    );

    expect(outcome.exitCode).toBe(4);
    expect(outcome.result.reason).toBe("ai_ranking_failed");
    expect(JSON.stringify(outcome.result)).not.toContain(leakedToken);
    expect(outcome.result.details).toMatchObject({
      kind: "MalformedOutput",
      providerDetails: {
        apiKey: "[REDACTED]",
        nested: { authorization: "[REDACTED]" },
        url: "https://provider.example/v1?api_key=[REDACTED]"
      }
    });
  });

  it("treats AI ranking with no eligible returned sha as ai_ranking_failed", async () => {
    const root = await indexedRoot([
      imageFixture("a-sink.jpg", "Sink", "Bathroom", "small sink", "bathroom")
    ]);
    const rank = vi.fn(async () => [
      { sha256: "f".repeat(64), score: 0.9, reason: "unknown candidate" }
    ]);

    const outcome = await pickService(
      root,
      { category: "bathroom", query: "sink", semantic: "ai" },
      { textRanker: { id: "partial-ai", rank } }
    );

    expect(outcome.exitCode).toBe(4);
    expect(outcome.result.reason).toBe("ai_ranking_failed");
    expect(outcome.result.details).toMatchObject({
      kind: "MalformedOutput",
      providerDetails: { rankedCount: 1 }
    });
  });

  it("treats empty AI ranking for non-empty eligible input as ai_ranking_failed", async () => {
    const root = await indexedRoot([
      imageFixture("a-sink.jpg", "Sink", "Bathroom", "small sink", "bathroom")
    ]);
    const rank = vi.fn(async () => []);

    const outcome = await pickService(
      root,
      { category: "bathroom", query: "sink", semantic: "ai" },
      { textRanker: { id: "empty-ai", rank } }
    );

    expect(outcome.exitCode).toBe(4);
    expect(outcome.result.reason).toBe("ai_ranking_failed");
    expect(outcome.result.details).toMatchObject({
      kind: "MalformedOutput",
      providerDetails: { rankedCount: 0 }
    });
  });

  it("does not call the ranker when no candidate satisfies constraints", async () => {
    const root = await indexedRoot([
      imageFixture("a-kitchen.jpg", "Kitchen", "Kitchen", "kitchen", "kitchen")
    ]);
    const rank = vi.fn(async () => []);

    const outcome = await pickService(
      root,
      { category: "bathroom", query: "bright shower", semantic: "ai", topK: 1 },
      { textRanker: { id: "ai", rank } }
    );

    expect(outcome.exitCode).toBe(2);
    expect(outcome.result.reason).toBe("no_candidate");
    expect(rank).not.toHaveBeenCalled();
    const details = outcome.result.details as {
      alternatives: unknown[];
      ranking: { status: string; reason: string; topK?: number };
    };
    expect(details.alternatives).toHaveLength(1);
    expect(details.ranking.status).toBe("no_candidate");
    expect(details.ranking.reason).toBe("no_candidate");
    expect(details.ranking).not.toHaveProperty("topK");
  });

  it("leaves the no-query constraint path without ranking", async () => {
    const root = await indexedRoot([
      imageFixture("a-sink.jpg", "Sink", "Bathroom", "small sink", "bathroom")
    ]);
    const rank = vi.fn(async () => {
      throw new Error("should not rank");
    });

    const outcome = await pickService(
      root,
      { category: "bathroom" },
      { textRanker: { id: "ai", rank } }
    );

    expect(outcome.exitCode).toBe(0);
    expect(rank).not.toHaveBeenCalled();
    expect(successManifest(outcome.result.details).ranking).toBeUndefined();
  });

  it("routes explicit Unsplash source without requiring a local index", async () => {
    const root = await tempRoot();
    const sourceBuffer = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#ddeeff" }
    })
      .jpeg()
      .toBuffer();
    const photo = {
      id: "unsplash-photo",
      description: "Spa hero",
      altDescription: "Bright spa bathroom",
      width: 1200,
      height: 800,
      urls: {
        raw: undefined,
        full: "https://images.unsplash.com/photo.jpg",
        regular: undefined,
        small: undefined,
        thumb: undefined
      },
      links: {
        html: "https://unsplash.com/photos/unsplash-photo",
        downloadLocation: "https://api.unsplash.com/photos/unsplash-photo/download"
      },
      photographerName: "Jane Doe",
      photographerUsername: "jane",
      photographerUrl: "https://unsplash.com/@jane",
      attributionText: "Photo by Jane Doe on Unsplash",
      attributionHtml: "Photo by Jane Doe on Unsplash"
    };
    const unsplashClient = {
      searchPhotos: vi.fn(async () => [photo]),
      trackDownload: vi.fn(async () => undefined),
      downloadPhoto: vi.fn(async () => sourceBuffer)
    };

    const outcome = await pickService(
      root,
      { source: "unsplash", query: "spa hero", orientation: "landscape", width: 600, height: 400 },
      { unsplashClient }
    );

    expect(outcome.exitCode).toBe(0);
    expect(unsplashClient.searchPhotos).toHaveBeenCalledWith(
      expect.objectContaining({ query: "spa hero", orientation: "landscape" })
    );
    expect(unsplashClient.trackDownload).toHaveBeenCalledWith(photo);
    const manifest = successManifest(outcome.result.details);
    expect(manifest).toMatchObject({
      source: "unsplash",
      photoId: "unsplash-photo",
      photographerName: "Jane Doe",
      width: 600,
      height: 400
    });
    await expect(fs.stat(path.join(root, manifest.output))).resolves.toBeTruthy();
    const usageLines = (await fs.readFile(path.join(root, ".img-ia", "usage.jsonl"), "utf8"))
      .trim()
      .split("\n");
    expect(usageLines).toHaveLength(1);
  });

  it("does not reuse the same Unsplash image for the same slot and location", async () => {
    const root = await tempRoot();
    const firstBuffer = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#112233" }
    })
      .jpeg()
      .toBuffer();
    const secondBuffer = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#445566" }
    })
      .jpeg()
      .toBuffer();
    const photos = [
      unsplashPhoto("first", "https://images.unsplash.com/first.jpg"),
      unsplashPhoto("second", "https://images.unsplash.com/second.jpg")
    ];
    const unsplashClient = {
      searchPhotos: vi.fn(async () => photos),
      trackDownload: vi.fn(async () => undefined),
      downloadPhoto: vi.fn(async (photo: (typeof photos)[number]) =>
        photo.id === "first" ? firstBuffer : secondBuffer
      )
    };
    const options = {
      source: "unsplash" as const,
      query: "spa hero",
      slot: "home.hero",
      location: "pages/home"
    };

    const first = await pickService(root, options, { unsplashClient });
    const second = await pickService(root, options, { unsplashClient });

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(successManifest(first.result.details).photoId).toBe("first");
    expect(successManifest(second.result.details).photoId).toBe("second");
  });
});

function unsplashPhoto(id: string, full: string) {
  return {
    id,
    description: "Spa hero",
    altDescription: "Bright spa bathroom",
    width: 1200,
    height: 800,
    urls: { raw: undefined, full, regular: undefined, small: undefined, thumb: undefined },
    links: {
      html: `https://unsplash.com/photos/${id}`,
      downloadLocation: `https://api.unsplash.com/photos/${id}/download`
    },
    photographerName: "Jane Doe",
    photographerUsername: "jane",
    photographerUrl: "https://unsplash.com/@jane",
    attributionText: "Photo by Jane Doe on Unsplash",
    attributionHtml: "Photo by Jane Doe on Unsplash"
  };
}

type Fixture = {
  rel: string;
  title: string;
  subject: string;
  description: string;
  category: string;
};

function imageFixture(
  rel: string,
  title: string,
  subject: string,
  description: string,
  category: string
): Fixture {
  return { rel, title, subject, description, category };
}

async function indexedRoot(fixtures: readonly Fixture[]): Promise<string> {
  const root = await tempRoot();
  const sidecars = await Promise.all(
    fixtures.map((fixture) => writeImageAndSidecar(root, fixture))
  );
  const index = new SqliteIndex(root);
  try {
    await index.rebuildFromSidecars(sidecars);
  } finally {
    index.close();
  }
  await fs.mkdir(path.join(root, ".img-ia", "sidecars"), { recursive: true });
  for (const sidecar of sidecars) {
    await fs.writeFile(
      path.join(root, ".img-ia", "sidecars", `${sidecar.sha256}.json`),
      `${JSON.stringify(sidecar)}\n`
    );
  }
  return root;
}

async function writeImageAndSidecar(root: string, fixture: Fixture): Promise<Sidecar> {
  const fullPath = path.join(root, fixture.rel);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await sharp({
    create: { width: 200, height: 100, channels: 3, background: colorFor(fixture.rel) }
  })
    .jpeg()
    .toFile(fullPath);
  const sha = crypto
    .createHash("sha256")
    .update(await fs.readFile(fullPath))
    .digest("hex");
  return {
    sha256: sha,
    classification: {
      subject: fixture.subject,
      categories: [fixture.category],
      orientation: "landscape",
      altText: fixture.description,
      title: fixture.title,
      description: fixture.description,
      suggestedSlug: fixture.title.toLowerCase().replace(/\s+/g, "-")
    },
    dims: { width: 200, height: 100 },
    originalName: fixture.rel,
    model: "test",
    canonicalRelPath: fixture.rel,
    occurrences: [fixture.rel],
    primaryFlag: "canonicalRelPath"
  };
}

function colorFor(seed: string): { r: number; g: number; b: number } {
  const bytes = crypto.createHash("sha256").update(seed).digest();
  return { r: bytes[0]!, g: bytes[1]!, b: bytes[2]! };
}

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-pick-semantic-"));
  roots.push(root);
  return root;
}

type SuccessManifest = {
  source: string;
  output: string;
  width: number;
  height: number;
  photoId?: string;
  photographerName?: string;
  ranking?: {
    status: string;
    mode: string;
    query: string;
    reason: string;
    score: number;
    topK: number;
    alternatives: unknown[];
  };
};

function successManifest(details: unknown): SuccessManifest {
  return (details as { manifest: SuccessManifest }).manifest;
}
