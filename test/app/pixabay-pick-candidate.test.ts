import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  PixabayClientError,
  type PixabaySearchHit,
  type PixabaySearchOptions,
  type PixabaySearchResult
} from "../../src/adapters/pixabay-client.js";
import {
  PIXABAY_CACHE_TTL_MS,
  PixabayResponseCache,
  canonicalKey
} from "../../src/adapters/pixabay-response-cache.js";
import { PixabayUsedIds } from "../../src/adapters/pixabay-used-ids.js";
import {
  acquirePixabayCandidate,
  buildPixabaySearchIdentity,
  type PixabayCandidateRequest
} from "../../src/app/pixabay-pick-service.js";

const SHA_A = "a".repeat(64);
const NOW0 = Date.parse("2026-08-07T12:00:00.000Z");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
  roots.length = 0;
});
async function tempRoot(): Promise<string> {
  roots.push(await fs.mkdtemp(path.join(os.tmpdir(), "pixabay-cand-")));
  return roots[roots.length - 1]!;
}
function hit(p: Partial<PixabaySearchHit> & Pick<PixabaySearchHit, "id">): PixabaySearchHit {
  return {
    pageURL: `https://pixabay.com/photos/x-${p.id}/`,
    webformatURL: `https://cdn.example/w-${p.id}.jpg`,
    largeImageURL: `https://cdn.example/l-${p.id}.jpg`,
    imageWidth: 2000,
    imageHeight: 1333,
    user: "alice",
    ...p
  };
}
type SearchFn = Mock<(o: PixabaySearchOptions) => Promise<PixabaySearchResult>>;
async function seam(
  req: PixabayCandidateRequest,
  impl: () => Promise<PixabaySearchResult>,
  extra: { root?: string; usedShas?: ReadonlySet<string>; usedIds?: PixabayUsedIds } = {}
) {
  const root = extra.root ?? (await tempRoot());
  const search = vi.fn(impl) as SearchFn;
  const result = await acquirePixabayCandidate(req, {
    client: { search },
    cache: new PixabayResponseCache({ root, now: () => NOW0 }),
    usedIds: extra.usedIds ?? new PixabayUsedIds({ root }),
    ...(extra.usedShas ? { usedShas: extra.usedShas } : {})
  });
  return { search, result };
}

describe("acquirePixabayCandidate (WU5b2)", () => {
  it("identity + cache hit/miss/stale; forces photo; maps orientation", async () => {
    const id = buildPixabaySearchIdentity({
      query: "kitchen",
      safesearch: true,
      perPage: 20,
      orientation: "horizontal"
    });
    expect(id).toBe(
      canonicalKey(
        "https://pixabay.com/api/?q=kitchen&image_type=photo&safesearch=true&per_page=20&orientation=horizontal"
      )
    );
    expect(id).not.toMatch(/[?&]key=/i);
    expect(
      buildPixabaySearchIdentity({ query: "t", safesearch: false, perPage: 20 })
    ).not.toContain("orientation=");
    const root = await tempRoot();
    let now = NOW0;
    const search = vi.fn(async () => ({
      hits: [hit({ id: 101 }), hit({ id: 102 })],
      total: 2,
      rateLimit: { limit: 100, remaining: 99, resetSeconds: 40 }
    })) as SearchFn;
    const deps = {
      client: { search },
      cache: new PixabayResponseCache({ root, now: () => now }),
      usedIds: new PixabayUsedIds({ root })
    };
    const req: PixabayCandidateRequest = {
      query: "kitchen",
      orientation: "landscape",
      width: 800,
      height: 500,
      safeSearch: true
    };
    expect(await acquirePixabayCandidate(req, deps)).toMatchObject({
      ok: true,
      cache: "miss",
      candidate: { hit: { id: 101 }, url: "https://cdn.example/l-101.jpg" },
      rateLimit: { limit: 100, remaining: 99, resetSeconds: 40 }
    });
    expect(search.mock.calls[0]![0]).toMatchObject({
      query: "kitchen",
      safesearch: true,
      orientation: "horizontal",
      perPage: 20
    });
    expect(search.mock.calls[0]![0]).not.toHaveProperty("image_type");
    search.mockClear();
    expect((await acquirePixabayCandidate(req, deps)).cache).toBe("hit");
    expect(search).not.toHaveBeenCalled();
    now += PIXABAY_CACHE_TTL_MS + 1;
    search.mockImplementation(async () => ({ hits: [hit({ id: 909 })], total: 1 }));
    expect(await acquirePixabayCandidate(req, deps)).toMatchObject({
      ok: true,
      cache: "stale",
      candidate: { hit: { id: 909 } }
    });
    expect(search).toHaveBeenCalledOnce();
  });

  it("filters/dedupe/winner/cap/panorama + errors/no_candidate without download", async () => {
    const root = await tempRoot();
    const usedIds = new PixabayUsedIds({ root });
    await usedIds.append(101, SHA_A);
    const { result, search } = await seam(
      { query: "kitchen remodel", orientation: "landscape", width: 1200, height: 800 },
      async () => ({
        hits: [
          hit({ id: 101 }),
          hit({ id: 101, user: "dup" }),
          hit({ id: 303, imageWidth: 4000, imageHeight: 1000 }),
          hit({ id: 404, imageWidth: 100, imageHeight: 80 }),
          hit({ id: 505, user: "winner", imageWidth: 4000, imageHeight: 3000 }),
          hit({ id: 606, imageWidth: 3000, imageHeight: 2000 })
        ],
        total: 6
      }),
      { root, usedIds, usedShas: new Set([SHA_A]) }
    );
    expect(result).toMatchObject({
      ok: true,
      candidate: { hit: { id: 505, user: "winner" }, url: "https://cdn.example/l-505.jpg" },
      candidatesFiltered: 6
    });
    if (!result.ok) throw new Error("ok");
    expect(result.candidate.warning).toBeUndefined();
    expect(search).toHaveBeenCalledOnce();
    const cap = await seam({ query: "wide", width: 1600, height: 1200 }, async () => ({
      hits: [hit({ id: 777, imageWidth: 4000, imageHeight: 3000 })],
      total: 1
    }));
    expect(cap.result.ok && cap.result.candidate.warning).toMatchObject({
      code: "resolution_cap",
      cause: "full_api_access_unavailable"
    });
    expect(cap.result.ok && cap.result.candidate.dims.width).toBeLessThanOrEqual(1280);
    const pano = await seam(
      { query: "coast", orientation: "panorama", width: 800, height: 300 },
      async () => ({
        hits: [
          hit({ id: 1, imageWidth: 1800, imageHeight: 1000 }),
          hit({ id: 2, imageWidth: 3000, imageHeight: 1000 })
        ],
        total: 2
      })
    );
    expect(pano.result).toMatchObject({ ok: true, candidate: { hit: { id: 2 } } });
    expect(pano.search.mock.calls[0]![0]).toMatchObject({ orientation: "horizontal" });
    const download = vi.fn(async () => {
      throw new Error("download must not run");
    });
    const rate = await acquirePixabayCandidate(
      { query: "k" },
      {
        client: {
          search: vi.fn(async () => {
            throw new PixabayClientError("rate_limited", "Pixabay rate limit exceeded", {
              status: 429,
              rateLimit: { limit: 100, remaining: 0, resetSeconds: 30 }
            });
          }),
          download
        } as never,
        cache: new PixabayResponseCache({ root, now: () => NOW0 }),
        usedIds: new PixabayUsedIds({ root })
      }
    );
    expect(rate).toMatchObject({
      ok: false,
      reason: "rate_limited",
      status: 429,
      rateLimit: { limit: 100, remaining: 0, resetSeconds: 30 }
    });
    expect(rate.ok === false && rate.message).not.toMatch(/[?&]key=/i);
    expect(download).not.toHaveBeenCalled();
    expect(
      (
        await seam({ query: "k" }, async () => {
          throw new PixabayClientError("network", "Unable to reach Pixabay API");
        })
      ).result
    ).toMatchObject({ ok: false, reason: "provider_error", kind: "network" });
    expect(
      (
        await seam({ query: "s", width: 2000, height: 1500 }, async () => ({
          hits: [hit({ id: 2, imageWidth: 100, imageHeight: 80 })],
          total: 1
        }))
      ).result
    ).toMatchObject({ ok: false, reason: "no_candidate", candidatesFiltered: 1 });
    const fileRoot = path.join(root, "not-a-dir");
    await fs.writeFile(fileRoot, "x", "utf8");
    const live = await acquirePixabayCandidate(
      { query: "live", width: 400, height: 300 },
      {
        client: { search: vi.fn(async () => ({ hits: [hit({ id: 42 })], total: 1 })) },
        cache: new PixabayResponseCache({ root: fileRoot, now: () => NOW0 }),
        usedIds: new PixabayUsedIds({ root })
      }
    );
    expect(live).toMatchObject({ ok: true, cache: "miss", candidate: { hit: { id: 42 } } });
    expect(JSON.stringify(live)).not.toMatch(/"bytes"|"manifest"|"output"/);
  });
});
