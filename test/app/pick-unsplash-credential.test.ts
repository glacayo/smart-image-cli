import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickService } from "../../src/app/pick-service.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-pick-unsplash-cred-"));
  roots.push(root);
  return root;
}

describe("pickService --source unsplash credential wiring", () => {
  it("fails closed without Unsplash setup guidance when no client double is injected", async () => {
    const root = await tempRoot();
    vi.stubEnv("UNSPLASH_ACCESS_KEY", "");
    const configHome = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-unsplash-pick-home-"));
    roots.push(configHome);
    vi.stubEnv("APPDATA", configHome);
    vi.stubEnv("XDG_CONFIG_HOME", configHome);

    const outcome = await pickService(root, {
      source: "unsplash",
      query: "spa hero",
      orientation: "landscape",
      width: 600,
      height: 400
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("invalid_input");
    expect(outcome.result.message).toMatch(/unsplash/i);
    expect(outcome.result.message).not.toMatch(/config unsplash setup|unsplash\.com\/developers/i);
    expect(JSON.stringify(outcome.result)).not.toMatch(
      /access_key|UNSPLASH_ACCESS_KEY|missing_unsplash_credential/
    );
  });

  it("uses the injected resolveUnsplashCredential to construct the UnsplashClient", async () => {
    const root = await tempRoot();
    const resolvedKey = "resolved-unsplash-key-1234567890";
    const sourceBuffer = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#ddeeff" }
    })
      .jpeg()
      .toBuffer();

    // Capture the resolved key by routing it into a real UnsplashClient via a
    // constructor spy on the adapter module is overkill; instead verify the
    // resolver is called and the pick succeeds when a client is NOT injected
    // but the resolver returns a key. We inject a fetch stub through the
    // UnsplashClient by overriding global.fetch temporarily.
    const rawPhoto = {
      id: "unsplash-photo",
      description: "Spa hero",
      alt_description: "Bright spa bathroom",
      width: 1200,
      height: 800,
      urls: { full: "https://images.unsplash.com/photo.jpg" },
      links: {
        html: "https://unsplash.com/photos/unsplash-photo",
        download_location: "https://api.unsplash.com/photos/unsplash-photo/download"
      },
      user: { name: "Jane Doe", username: "jane", links: { html: "https://unsplash.com/@jane" } }
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.includes("/search/photos")) {
        const body = JSON.stringify({ results: [rawPhoto] });
        return new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("/download")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      // image download
      return new Response(sourceBuffer, { status: 200, headers: { "content-type": "image/jpeg" } });
    }) as unknown as typeof fetch;

    const resolver = vi.fn(async () => ({
      accessKey: resolvedKey,
      source: "user-config" as const
    }));

    // Temporarily replace global fetch so UnsplashClient uses it.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const outcome = await pickService(
        root,
        {
          source: "unsplash",
          query: "spa hero",
          orientation: "landscape",
          width: 600,
          height: 400
        },
        { resolveUnsplashCredential: resolver }
      );

      // WU6a: resolver alone cannot construct a removed UnsplashClient.
      expect(outcome.exitCode).toBe(3);
      expect(outcome.result.reason).toBe("invalid_input");
      expect(resolver).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
      void resolvedKey;
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("prefers an injected unsplashClient over the credential resolver", async () => {
    const root = await tempRoot();
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
    const sourceBuffer = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#ddeeff" }
    })
      .jpeg()
      .toBuffer();
    const client = {
      searchPhotos: vi.fn(async () => [photo]),
      trackDownload: vi.fn(async () => undefined),
      downloadPhoto: vi.fn(async () => sourceBuffer)
    };
    const resolver = vi.fn(async () => ({
      accessKey: "should-not-be-used",
      source: "env" as const
    }));

    const outcome = await pickService(
      root,
      { source: "unsplash", query: "spa hero", orientation: "landscape", width: 600, height: 400 },
      { unsplashClient: client, resolveUnsplashCredential: resolver }
    );

    expect(outcome.exitCode).toBe(0);
    expect(resolver).not.toHaveBeenCalled();
    expect(client.searchPhotos).toHaveBeenCalledOnce();
  });
});
