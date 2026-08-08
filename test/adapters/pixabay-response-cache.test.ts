import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PIXABAY_CACHE_TTL_MS,
  PixabayResponseCache,
  canonicalKey
} from "../../src/adapters/pixabay-response-cache.js";

const KEY = "test-pixabay-key-NOT-REAL";
const SECRET_URL = `https://pixabay.com/api/?key=${KEY}&q=kitchen&image_type=photo&safesearch=true`;
const PAYLOAD = {
  hits: [{ id: 42, user: "alice" }],
  total: 1,
  rateLimit: { limit: 100, remaining: 99, resetSeconds: 45 }
};

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("PixabayResponseCache", () => {
  it("canonicalKey strips key, sorts params, and stays key-free for identity + path", () => {
    const a = canonicalKey(SECRET_URL);
    const b = canonicalKey(
      "https://pixabay.com/api/?safesearch=true&image_type=photo&q=kitchen&key=other-secret"
    );
    const c = canonicalKey(
      "https://pixabay.com/api/?q=kitchen&image_type=photo&safesearch=true"
    );
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).not.toMatch(/key=/i);
    expect(a).not.toContain(KEY);
    expect(a).toContain("image_type=photo");
    expect(a).toContain("q=kitchen");
    expect(a.indexOf("image_type=")).toBeLessThan(a.indexOf("q="));

    const withOrient = canonicalKey(
      "https://pixabay.com/api/?orientation=horizontal&key=x&q=spa&image_type=photo&safesearch=false"
    );
    expect(withOrient).not.toMatch(/[?&]key=/i);
    expect(withOrient).toMatch(/image_type=photo.*orientation=horizontal.*q=spa.*safesearch=false/);
  });

  it("fresh hit / stale miss / corrupt miss; write is atomic, 0600, and key-free on disk", async () => {
    const root = await tempRoot();
    let now = Date.parse("2026-08-07T12:00:00.000Z");
    const cache = new PixabayResponseCache({ root, now: () => now });
    const key = canonicalKey(SECRET_URL);

    expect(await cache.read(key)).toEqual({ status: "miss" });

    await cache.write(key, PAYLOAD);
    const fresh = await cache.read(key);
    expect(fresh).toEqual({ status: "hit", value: PAYLOAD });

    const filePath = cache.pathFor(key);
    expect(filePath).toBe(
      path.join(root, ".img-ia", "pixabay", "cache", `${sha256(key)}.json`)
    );
    expect(path.basename(filePath)).not.toContain(KEY);
    expect(filePath).not.toContain(KEY);

    const raw = await fs.readFile(filePath, "utf8");
    expect(raw).not.toContain(KEY);
    expect(raw).not.toMatch(/[?&]key=/i);
    expect(JSON.parse(raw)).toMatchObject({
      cachedAt: now,
      identity: key,
      payload: PAYLOAD
    });

    const stat = await fs.stat(filePath);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }

    // Stale after TTL boundary (exactly TTL is still fresh; TTL+1 is stale).
    now = now + PIXABAY_CACHE_TTL_MS;
    expect(await cache.read(key)).toEqual({ status: "hit", value: PAYLOAD });
    now = now + 1;
    expect(await cache.read(key)).toEqual({ status: "stale" });

    // Corrupt / malformed entries become miss (never throw).
    await fs.writeFile(filePath, "{not-json", "utf8");
    expect(await cache.read(key)).toEqual({ status: "miss" });

    await fs.writeFile(filePath, JSON.stringify({ cachedAt: Date.now(), payload: PAYLOAD }), "utf8");
    expect(await cache.read(key)).toEqual({ status: "miss" }); // missing identity

    await fs.writeFile(
      filePath,
      JSON.stringify({ cachedAt: "nope", identity: key, payload: PAYLOAD }),
      "utf8"
    );
    expect(await cache.read(key)).toEqual({ status: "miss" });

    // Reject write that would persist key material; disk stays key-free.
    await expect(
      cache.write(key, { leak: `https://pixabay.com/api/?key=${KEY}&q=x` })
    ).resolves.toBe(false);
    const afterReject = await fs.readFile(filePath, "utf8").catch(() => "");
    expect(afterReject).not.toContain(KEY);

    // Atomic rename: successful write leaves no .tmp siblings.
    now = Date.parse("2026-08-07T18:00:00.000Z");
    expect(await cache.write(key, { hits: [], total: 0 })).toBe(true);
    const dir = path.dirname(filePath);
    const names = await fs.readdir(dir);
    expect(names.filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(names).toContain(path.basename(filePath));
    expect(await cache.read(key)).toEqual({ status: "hit", value: { hits: [], total: 0 } });

    // Read/write failures are non-fatal (miss / false), never throw for IO.
    const fileRoot = path.join(root, "not-a-dir");
    await fs.writeFile(fileRoot, "x", "utf8");
    const bad = new PixabayResponseCache({ root: fileRoot, now: () => now });
    await expect(bad.read(key)).resolves.toEqual({ status: "miss" });
    await expect(bad.write(key, PAYLOAD)).resolves.toBe(false);
  });

  it("same canonical identity shares one file; different queries do not collide", async () => {
    const root = await tempRoot();
    const cache = new PixabayResponseCache({
      root,
      now: () => Date.parse("2026-08-07T12:00:00.000Z")
    });
    const k1 = canonicalKey(SECRET_URL);
    const k2 = canonicalKey(
      "https://pixabay.com/api/?key=another&q=kitchen&image_type=photo&safesearch=true"
    );
    const k3 = canonicalKey(
      "https://pixabay.com/api/?key=x&q=bathroom&image_type=photo&safesearch=true"
    );
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);

    await cache.write(k1, { id: "kitchen" });
    await cache.write(k3, { id: "bath" });
    expect(await cache.read(k2)).toEqual({ status: "hit", value: { id: "kitchen" } });
    expect(await cache.read(k3)).toEqual({ status: "hit", value: { id: "bath" } });
    expect(cache.pathFor(k1)).toBe(cache.pathFor(k2));
    expect(cache.pathFor(k1)).not.toBe(cache.pathFor(k3));
  });
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pixabay-cache-"));
  roots.push(root);
  return root;
}
