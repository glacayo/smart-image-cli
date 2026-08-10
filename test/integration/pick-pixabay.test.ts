import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PixabayClientError, type PixabaySearchHit } from "../../src/adapters/pixabay-client.js";
import { pickService } from "../../src/app/pick-service.js";
import { rmWithRetry } from "../support/cleanup.js";

const roots: string[] = [];
const SECRET = "pixabay-secret-key-NEVER-LEAK-9f3c2a1b";
afterEach(async () => {
  vi.unstubAllEnvs();
  // Windows: Sharp/better-sqlite3 can briefly lock files under temp Pixabay roots
  // (cache/sqlite/WAL/produced assets). Bare fs.rm fails with ENOTEMPTY; project
  // helper retries EBUSY/EPERM/ENOTEMPTY so teardown stays deterministic.
  await Promise.all(roots.map((r) => rmWithRetry(r)));
  roots.length = 0;
});
const tmp = async () => {
  roots.push(await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-pick-pixabay-")));
  return roots[roots.length - 1]!;
};
const jpeg = (w: number, h: number, c = "#cde") =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } })
    .jpeg()
    .toBuffer();
const hit = (p: Partial<PixabaySearchHit> & Pick<PixabaySearchHit, "id">): PixabaySearchHit => ({
  pageURL: `https://pixabay.com/photos/x-${p.id}/`,
  webformatURL: `https://cdn.example/w-${p.id}.jpg`,
  largeImageURL: `https://cdn.example/l-${p.id}.jpg`,
  imageWidth: 2000,
  imageHeight: 1333,
  user: "alice",
  ...p
});
const man = (o: { result: { details?: unknown } }) =>
  (o.result.details as { manifest: Record<string, unknown> }).manifest;
const gone = (p: string) => expect(fs.access(p)).rejects.toMatchObject({ code: "ENOENT" });
const px = (id: number) => path.join(".img-ia", "pixabay", `${id}.jpg`);

describe("pickService --source pixabay (WU5b3)", () => {
  it("teardown uses rmWithRetry (not bare fs.rm) for Windows temp locks", async () => {
    const src = await fs.readFile(fileURLToPath(import.meta.url), "utf8");
    expect(src).toMatch(/rmWithRetry/);
    expect(src).toMatch(/from ["']\.\.\/support\/cleanup\.js["']/);
    expect(src).not.toMatch(/fs\.rm\(\s*r\s*,\s*\{\s*recursive:\s*true/);
  });

  it("success: license, used-id, and one download on first pick", async () => {
    const root = await tmp();
    const body = await jpeg(1280, 853, "#abc");
    const hits = [
      hit({ id: 101, user: "alice", pageURL: "https://pixabay.com/photos/kitchen-101/" }),
      hit({ id: 101, user: "dup" }),
      hit({ id: 202, user: "bob", imageWidth: 2400, imageHeight: 1600 }),
      hit({ id: 303, imageWidth: 800, imageHeight: 600 })
    ];
    const download = vi.fn(async () => body);
    const search = vi.fn(async () => ({ hits, total: hits.length }));
    const first = await pickService(
      root,
      {
        source: "pixabay",
        query: "kitchen remodel",
        orientation: "landscape",
        width: 1200,
        height: 800,
        slot: "hero",
        location: "home",
        safeSearch: true
      },
      { pixabayClient: { search, download } }
    );
    expect(first.exitCode).toBe(0);
    expect(search).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).toMatchObject({
      query: "kitchen remodel",
      safesearch: true,
      orientation: "horizontal"
    });
    const m = man(first);
    expect(m).toMatchObject({
      source: "pixabay",
      pixabayId: 101,
      pageURL: "https://pixabay.com/photos/kitchen-101/",
      contributor: "alice",
      license: "Pixabay Content License",
      cache: "miss"
    });
    expect(String(m.disclaimer)).toMatch(/combined.?work|standalone|redistribut/i);
    expect(String(m.sha256)).toHaveLength(64);
    expect(Number(m.width)).toBeLessThanOrEqual(1280);
    await fs.access(path.join(root, String(m.output)));
    await fs.access(path.join(root, px(101)));
    const usedTxt = await fs.readFile(
      path.join(root, ".img-ia", "pixabay", "used-ids.jsonl"),
      "utf8"
    );
    expect(usedTxt).toContain(`"id":101`);
    expect(
      usedTxt + (await fs.readFile(path.join(root, ".img-ia", "usage.jsonl"), "utf8"))
    ).toContain(String(m.sha256));
    expect(JSON.stringify(first.result)).not.toContain(SECRET);
  });

  it("success: resolution_cap warning when request exceeds available rendition", async () => {
    const capDl = vi.fn(async () => jpeg(1280, 960, "#123"));
    const cap = await pickService(
      await tmp(),
      { source: "pixabay", query: "wide", width: 1600, height: 1200, slot: "b", location: "t" },
      {
        pixabayClient: {
          search: vi.fn(async () => ({
            hits: [hit({ id: 404, imageWidth: 4000, imageHeight: 3000 })],
            total: 1
          })),
          download: capDl
        }
      }
    );
    expect(cap.exitCode).toBe(0);
    expect(capDl).toHaveBeenCalledTimes(1);
    expect(man(cap).warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "resolution_cap", cause: "full_api_access_unavailable" })
      ])
    );
    expect(Number(man(cap).width)).toBeLessThanOrEqual(1280);
  });

  it("success: dedupe skips used id and allowReuse can reselect it", async () => {
    const root = await tmp();
    const [a, b] = await Promise.all([jpeg(1280, 853, "#abc"), jpeg(1280, 853, "#def")]);
    const firstHit = hit({
      id: 101,
      user: "alice",
      pageURL: "https://pixabay.com/photos/kitchen-101/"
    });
    const secondHit = hit({ id: 202, user: "bob", imageWidth: 2400, imageHeight: 1600 });
    const download = vi.fn(async (url: string) => (String(url).includes("202") ? b : a));
    const search = vi.fn(async () => ({
      hits: [
        firstHit,
        hit({ id: 101, user: "dup" }),
        secondHit,
        hit({ id: 303, imageWidth: 800, imageHeight: 600 })
      ],
      total: 4
    }));
    const c = { search, download };
    const opts = {
      source: "pixabay" as const,
      query: "kitchen remodel",
      orientation: "landscape" as const,
      width: 1200,
      height: 800,
      slot: "hero",
      location: "home",
      safeSearch: true
    };
    expect((await pickService(root, opts, { pixabayClient: c })).exitCode).toBe(0);

    download.mockClear();
    search.mockImplementation(async () => ({ hits: [firstHit, secondHit], total: 2 }));
    const second = await pickService(root, opts, { pixabayClient: c });
    expect(second.exitCode).toBe(0);
    expect(man(second).pixabayId).toBe(202);
    expect(download).toHaveBeenCalledTimes(1);

    download.mockClear();
    search.mockImplementation(async () => ({ hits: [firstHit], total: 1 }));
    const reused = await pickService(root, { ...opts, allowReuse: true }, { pixabayClient: c });
    expect(reused.exitCode).toBe(0);
    expect(man(reused).pixabayId).toBe(101);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("success: search cache hit on second pick with distinct slot", async () => {
    const cRoot = await tmp();
    const s2 = vi.fn(async () => ({ hits: [hit({ id: 777 })], total: 1 }));
    const d2 = vi.fn(async () => jpeg(1280, 853, "#777"));
    const base = {
      source: "pixabay" as const,
      query: "cached kitchen",
      orientation: "landscape" as const,
      width: 800,
      height: 500,
      slot: "a",
      location: "b"
    };
    expect(
      (await pickService(cRoot, base, { pixabayClient: { search: s2, download: d2 } })).exitCode
    ).toBe(0);
    const c2 = await pickService(
      cRoot,
      { ...base, slot: "c", location: "d" },
      { pixabayClient: { search: s2, download: d2 } }
    );
    expect(c2.exitCode).toBe(0);
    expect(man(c2).cache).toBe("hit");
    expect(s2).toHaveBeenCalledTimes(1);
    expect(d2).toHaveBeenCalledTimes(2);
  });

  it("failures: usage rollback, used-id degrade, download, missing cred, rate limit, no_candidate", async () => {
    const failRoot = await tmp();
    const failed = await pickService(
      failRoot,
      { source: "pixabay", query: "fail", width: 600, height: 400, slot: "s", location: "l" },
      {
        pixabayClient: {
          search: vi.fn(async () => ({ hits: [hit({ id: 505 })], total: 1 })),
          download: vi.fn(async () => jpeg(1280, 853, "#faa"))
        },
        index: {
          recordUsageEvent: () => {
            throw new Error("sqlite boom");
          },
          close: () => undefined
        } as never
      }
    );
    expect(failed).toMatchObject({ exitCode: 5, result: { reason: "usage_failed" } });
    expect(await fs.readdir(path.join(failRoot, "_out")).catch(() => [])).toEqual([]);
    await gone(path.join(failRoot, ".img-ia", "pixabay", "used-ids.jsonl"));

    // R3-001: used-id index is secondary — append failure after durable usage must not roll back.
    const idxR = await tmp();
    const idxFail = await pickService(
      idxR,
      { source: "pixabay", query: "idx", width: 600, height: 400, slot: "s", location: "l" },
      {
        pixabayClient: {
          search: vi.fn(async () => ({ hits: [hit({ id: 707 })], total: 1 })),
          download: vi.fn(async () => jpeg(1280, 853, "#707"))
        },
        usedIds: {
          readMap: async () => new Map(),
          append: async () => {
            throw new Error(`used-id boom ${SECRET}`);
          }
        }
      }
    );
    expect(idxFail.exitCode).toBe(0);
    const im = man(idxFail);
    expect(im.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "used_id_index_degraded", cause: "append_failed" })
      ])
    );
    await fs.access(path.join(idxR, String(im.output)));
    await fs.access(path.join(idxR, px(707)));
    expect(await fs.readFile(path.join(idxR, ".img-ia", "usage.jsonl"), "utf8")).toContain(
      String(im.sha256)
    );
    await gone(path.join(idxR, ".img-ia", "pixabay", "used-ids.jsonl"));
    expect(JSON.stringify(idxFail.result)).not.toContain(SECRET);

    const dlR = await tmp();
    const dlFail = await pickService(
      dlR,
      { source: "pixabay", query: "dl", width: 400, height: 300, slot: "d", location: "l" },
      {
        pixabayClient: {
          search: vi.fn(async () => ({ hits: [hit({ id: 606 })], total: 1 })),
          download: vi.fn(async () => {
            throw new PixabayClientError("network", "Unable to download Pixabay image");
          })
        }
      }
    );
    expect(dlFail).toMatchObject({ exitCode: 4, result: { reason: "provider_error" } });
    await gone(path.join(dlR, px(606)));
    await gone(path.join(dlR, ".img-ia", "pixabay", "used-ids.jsonl"));
    expect(await fs.readdir(path.join(dlR, "_out")).catch(() => [])).toEqual([]);

    const root = await tmp();
    await fs.writeFile(path.join(root, "local.jpg"), await jpeg(200, 100));
    vi.stubEnv("PIXABAY_API_KEY", "");
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-pixabay-pick-home-"));
    roots.push(home);
    vi.stubEnv("APPDATA", home);
    vi.stubEnv("XDG_CONFIG_HOME", home);
    const miss = await pickService(root, { source: "pixabay", query: "k", width: 100, height: 50 });
    expect(miss).toMatchObject({ exitCode: 4, result: { reason: "missing_pixabay_credential" } });
    expect(JSON.stringify(miss.result)).not.toMatch(/local\.jpg|Indexed/i);
    expect(JSON.stringify(miss.result)).not.toContain(SECRET);

    const rate = await pickService(
      root,
      { source: "pixabay", query: "k" },
      {
        pixabayClient: {
          search: vi.fn(async () => {
            throw new PixabayClientError("rate_limited", "Pixabay rate limit exceeded", {
              status: 429,
              rateLimit: { limit: 100, remaining: 0, resetSeconds: 30 }
            });
          }),
          download: vi.fn(async () => {
            throw new Error("x");
          })
        }
      }
    );
    expect(rate).toMatchObject({ exitCode: 4, result: { reason: "rate_limited" } });
    expect(JSON.stringify(rate.result)).not.toContain(SECRET);

    const dl = vi.fn(async () => {
      throw new Error("no");
    });
    for (const x of [
      {
        o: { source: "pixabay" as const, query: "n", width: 2000, height: 1500 },
        hits: [hit({ id: 9, imageWidth: 100, imageHeight: 80 })]
      },
      { o: { source: "pixabay" as const, query: "z" }, hits: [] as PixabaySearchHit[] },
      {
        o: {
          source: "pixabay" as const,
          query: "p",
          orientation: "portrait" as const,
          width: 100,
          height: 200
        },
        hits: [hit({ id: 11, imageWidth: 2000, imageHeight: 1000 })]
      }
    ]) {
      expect(
        await pickService(root, x.o, {
          pixabayClient: {
            search: vi.fn(async () => ({ hits: x.hits, total: x.hits.length })),
            download: dl
          }
        })
      ).toMatchObject({ exitCode: 2, result: { reason: "no_candidate" } });
    }
    expect(dl).not.toHaveBeenCalled();
  });
});
