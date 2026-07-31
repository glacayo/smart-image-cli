import { describe, expect, it, vi } from "vitest";
import {
  OllamaCloudVisionProvider,
  resolveOllamaApiEndpoint
} from "../../src/adapters/vision/ollama-cloud.js";
import {
  AuthProviderError,
  MalformedOutputProviderError,
  ModelNotFoundProviderError
} from "../../src/adapters/vision/provider.js";

const apiKey = ["ollama", "test", "123456789012345678901234567"].join("_");

const validAnalysis = {
  subject: "Kitchen",
  categories: ["kitchen-remodeling"],
  orientation: "landscape",
  altText: "Kitchen",
  title: "Kitchen",
  description: "Kitchen photo",
  suggestedSlug: "kitchen"
};

const visionInput = {
  imageBytes: Buffer.from("fake-image"),
  mimeType: "image/jpeg",
  prompt: "Describe this image"
};

describe("OllamaCloudVisionProvider", () => {
  it("maps Ollama Cloud /v1 config endpoint to native /api chat endpoint", () => {
    expect(resolveOllamaApiEndpoint("https://ollama.com/v1")).toBe("https://ollama.com/api");
    expect(resolveOllamaApiEndpoint("https://ollama.com")).toBe("https://ollama.com/api");
    expect(resolveOllamaApiEndpoint("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/api"
    );
  });

  it("sends native Ollama vision payload with base64 images", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return jsonResponse({ message: { content: JSON.stringify(validAnalysis) } });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const provider = makeProvider(fetchImpl);

    const result = await provider.analyze(visionInput);

    expect(result.subject).toBe("Kitchen");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://ollama.com/api/chat");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ authorization: `Bearer ${apiKey}` });
    const body = JSON.parse(String(init?.body)) as {
      stream?: boolean;
      messages?: Array<{ content?: string; images?: string[] }>;
    };
    expect(body.stream).toBe(false);
    expect(body.messages?.[0]?.content).toBe(visionInput.prompt);
    expect(body.messages?.[0]?.images).toEqual([visionInput.imageBytes.toString("base64")]);
  });

  it("maps HTTP 401 to AuthProviderError without leaking the API key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: `invalid ${apiKey}` }, 401));
    const provider = makeProvider(fetchImpl);

    try {
      await provider.analyze(visionInput);
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthProviderError);
      expect(JSON.stringify((error as AuthProviderError).redactedDetails)).not.toContain(apiKey);
    }
  });

  it("maps model 404s to ModelNotFoundProviderError", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "model not found" }, 404));
    const provider = makeProvider(fetchImpl);

    await expect(provider.analyze(visionInput)).rejects.toBeInstanceOf(ModelNotFoundProviderError);
  });

  it("rejects invalid analysis JSON from Ollama message content", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: { content: "not json" } }));
    const provider = makeProvider(fetchImpl);

    await expect(provider.analyze(visionInput)).rejects.toBeInstanceOf(
      MalformedOutputProviderError
    );
  });
});

function makeProvider(fetchImpl: typeof fetch): OllamaCloudVisionProvider {
  return new OllamaCloudVisionProvider({
    id: "ollama",
    endpoint: "https://ollama.com/v1",
    model: "minimax-m3",
    apiKey,
    fetchImpl
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
