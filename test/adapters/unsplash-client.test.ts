import { describe, expect, it, vi } from "vitest";
import { UnsplashClient } from "../../src/adapters/unsplash-client.js";

describe("UnsplashClient", () => {
  it("searches photos with attribution and Unsplash orientation", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      expect(String(input)).toContain("orientation=squarish");
      return jsonResponse({
        results: [
          {
            id: "abc123",
            description: "Calm bathroom",
            alt_description: "bright spa bathroom",
            width: 2400,
            height: 1600,
            urls: { full: "https://images.unsplash.com/full.jpg" },
            links: {
              html: "https://unsplash.com/photos/abc123",
              download_location: "https://api.unsplash.com/photos/abc123/download"
            },
            user: {
              name: "Jane Doe",
              username: "jane",
              links: { html: "https://unsplash.com/@jane" }
            }
          }
        ]
      });
    });

    const client = new UnsplashClient({ accessKey: "test-key", fetch: fetchMock as typeof fetch });
    const photos = await client.searchPhotos({
      query: "spa bathroom",
      orientation: "squarish"
    });

    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({
      id: "abc123",
      photographerName: "Jane Doe",
      attributionText: "Photo by Jane Doe on Unsplash"
    });
    expect(photos[0]!.attributionHtml).toContain("Jane Doe");
    expect(photos[0]!.photographerUrl).toContain("utm_source=smart-image-cli");
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as Response;
}
