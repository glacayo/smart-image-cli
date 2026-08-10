import { describe, expect, it, vi } from "vitest";
import { PixabayClient, PixabayClientError } from "../../src/adapters/pixabay-client.js";

const KEY = "test-pixabay-key-NOT-REAL";
const HIT = {
  id: 42,
  pageURL: "https://pixabay.com/photos/kitchen-42/",
  webformatURL: "https://cdn.example/web.jpg",
  largeImageURL: "https://cdn.example/large.jpg",
  fullHDURL: "https://cdn.example/fullhd.jpg",
  imageURL: "https://cdn.example/source.jpg",
  imageWidth: 4000,
  imageHeight: 3000,
  user: "alice"
};

describe("PixabayClient", () => {
  it("search: photo+key+orientation+rate headers; free-tier parse; safesearch=false", async () => {
    const withOrient = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      expect(u.origin + u.pathname).toBe("https://pixabay.com/api/");
      expect(Object.fromEntries(u.searchParams)).toMatchObject({
        key: KEY,
        q: "kitchen remodel",
        image_type: "photo",
        safesearch: "true",
        orientation: "horizontal",
        per_page: "20"
      });
      return json({ total: 1, hits: [HIT] }, rates(100, 99, 45));
    });
    const full = await new PixabayClient({ apiKey: KEY, fetch: withOrient as typeof fetch }).search({
      query: "kitchen remodel",
      orientation: "horizontal",
      perPage: 20
    });
    expect(withOrient).toHaveBeenCalledTimes(1);
    expect(full.hits).toEqual([{ ...HIT }]);
    expect(full).toMatchObject({ total: 1, rateLimit: { limit: 100, remaining: 99, resetSeconds: 45 } });

    const free = {
      id: 7,
      pageURL: "https://pixabay.com/photos/bath-7/",
      webformatURL: "https://cdn.example/w.jpg",
      largeImageURL: "https://cdn.example/l.jpg",
      imageWidth: 2000,
      imageHeight: 1500,
      user: "bob"
    };
    const noOrient = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      expect(u.searchParams.has("orientation")).toBe(false);
      expect(u.searchParams.get("safesearch")).toBe("false");
      expect(u.searchParams.get("image_type")).toBe("photo");
      return json({ total: 3, hits: [free, { id: 9, webformatURL: "x" }, HIT] });
    });
    const filtered = await new PixabayClient({
      apiKey: KEY,
      fetch: noOrient as typeof fetch
    }).search({ query: "spa", safesearch: false });
    expect(filtered.hits.map((h) => h.id)).toEqual([7, 42]);
    expect(filtered.hits[0]).not.toHaveProperty("fullHDURL");
    expect(filtered.rateLimit).toBeUndefined();
  });

  it("429 → rate_limited once; http/network/json errors stay secret-free", async () => {
    const limited = vi.fn(async () => json({ message: "Too Many Requests" }, rates(100, 0, 30), 429));
    await expect(
      new PixabayClient({ apiKey: KEY, fetch: limited as typeof fetch }).search({ query: "k" })
    ).rejects.toMatchObject({
      name: "PixabayClientError",
      kind: "rate_limited",
      status: 429,
      rateLimit: { limit: 100, remaining: 0, resetSeconds: 30 }
    });
    expect(limited).toHaveBeenCalledTimes(1);

    const leak = `https://pixabay.com/api/?key=${KEY}&q=x`;
    const httpErr = await client(async () => json({ message: `denied for ${leak}` }, undefined, 403))
      .search({ query: "x" })
      .catch((e) => e);
    expect(httpErr).toMatchObject({ kind: "http", status: 403 });
    secretFree(httpErr);

    const netErr = await client(async () => {
      throw new Error(`connect failed for ${leak}`);
    })
      .search({ query: "x" })
      .catch((e) => e);
    expect(netErr.kind).toBe("network");
    secretFree(netErr);

    const jsonErr = await client(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError("bad json");
      },
      text: async () => "not-json"
    }))
      .search({ query: "x" })
      .catch((e) => e);
    expect(jsonErr.kind).toBe("invalid_json");
    secretFree(jsonErr);
  });

  it("download returns bytes; http failure secret-free without retry; empty key rejected", async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    const ok = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://cdn.example/large.jpg");
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      } as Response;
    });
    await expect(
      new PixabayClient({ apiKey: KEY, fetch: ok as typeof fetch }).download("https://cdn.example/large.jpg")
    ).resolves.toEqual(bytes);
    expect(ok).toHaveBeenCalledTimes(1);

    const fail = vi.fn(async () => json({ message: `fail key=${KEY}` }, undefined, 500));
    const err = await new PixabayClient({ apiKey: KEY, fetch: fail as typeof fetch })
      .download("https://cdn.example/x.jpg")
      .catch((e) => e);
    expect(err).toMatchObject({ kind: "http", status: 500 });
    secretFree(err);
    expect(fail).toHaveBeenCalledTimes(1);

    expect(() => new PixabayClient({ apiKey: "" })).toThrow(PixabayClientError);
    expect(() => new PixabayClient({ apiKey: "   " })).toThrow(/pixabay setup/i);
  });
});

function client(fetchImpl: () => Promise<unknown>): PixabayClient {
  return new PixabayClient({ apiKey: KEY, fetch: vi.fn(fetchImpl) as unknown as typeof fetch });
}
function rates(limit: number, remaining: number, reset: number): HeadersInit {
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(reset)
  };
}
function json(body: unknown, headers?: HeadersInit, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0)
  } as Response;
}
function secretFree(error: unknown): void {
  const text =
    error instanceof Error
      ? [error.message, error.stack, JSON.stringify(error), String((error as { cause?: unknown }).cause ?? "")].join("\n")
      : String(error);
  expect(text).not.toContain(KEY);
  expect(text).not.toMatch(/[?&]key=/i);
}
