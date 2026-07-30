import { describe, expect, it, vi } from "vitest";
import { ModelDiscoveryClient } from "../../../src/adapters/vision/model-discovery.js";
import {
  AuthProviderError,
  EndpointNotFoundProviderError,
  MalformedOutputProviderError
} from "../../../src/adapters/vision/provider.js";
import { defaultSecretRedactor } from "../../../src/adapters/secret-redactor.js";

// Build the test secret at runtime so no provider-shaped literal is committed.
const apiKey = ["sk", "test", "discovery12345678901234567890"].join("-");

function makeResponse(status: number, body: unknown, contentType = "application/json"): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": contentType }
  });
}

function clientOptions(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return {
    providerId: "ollama" as const,
    endpoint: "https://test.example.com/v1",
    apiKey,
    timeoutMs: 5_000,
    fetchImpl,
    redactor: defaultSecretRedactor,
    ...overrides
  };
}

describe("ModelDiscoveryClient.listModels", () => {
  it("returns normalized model ids from an OpenAI-compatible listing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, {
        data: [
          { id: "minimax-m3", object: "model" },
          { id: "glm-5.2", object: "model" }
        ]
      })
    );

    const client = new ModelDiscoveryClient(clientOptions(fetchImpl));
    const result = await client.listModels();

    expect(result).toEqual({
      supported: true,
      models: [
        { id: "minimax-m3", vision: null },
        { id: "glm-5.2", vision: null }
      ]
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://test.example.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: `Bearer ${apiKey}`
        })
      })
    );
  });

  it("maps OpenRouter input_modalities into vision true/false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, {
        data: [
          {
            id: "openai/gpt-4o-mini",
            architecture: { input_modalities: ["text", "image"] }
          },
          {
            id: "meta-llama/llama-3.1-8b-instruct",
            architecture: { input_modalities: ["text"] }
          }
        ]
      })
    );

    const client = new ModelDiscoveryClient(
      clientOptions(fetchImpl, {
        providerId: "openrouter",
        endpoint: "https://openrouter.ai/api/v1"
      })
    );
    const result = await client.listModels();

    expect(result.supported).toBe(true);
    if (!result.supported) return;
    expect(result.models).toEqual([
      { id: "openai/gpt-4o-mini", vision: true },
      { id: "meta-llama/llama-3.1-8b-instruct", vision: false }
    ]);
  });

  it("normalizes Gemini model ids by stripping a models/ prefix", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, {
        data: [{ id: "models/gemini-2.0-flash" }, { id: "gemini-1.5-pro" }]
      })
    );

    const client = new ModelDiscoveryClient(
      clientOptions(fetchImpl, {
        providerId: "gemini",
        endpoint: "https://generativelanguage.googleapis.com/v1beta/openai"
      })
    );
    const result = await client.listModels();

    expect(result.supported).toBe(true);
    if (!result.supported) return;
    expect(result.models.map((m) => m.id)).toEqual(["gemini-2.0-flash", "gemini-1.5-pro"]);
  });

  it("keeps Ollama bare listings with vision null when metadata lacks modalities", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, {
        data: [{ id: "minimax-m3" }, { id: "kimi-k2.5" }]
      })
    );

    const client = new ModelDiscoveryClient(clientOptions(fetchImpl, { providerId: "ollama" }));
    const result = await client.listModels();

    expect(result).toEqual({
      supported: true,
      models: [
        { id: "minimax-m3", vision: null },
        { id: "kimi-k2.5", vision: null }
      ]
    });
  });

  it("returns supported:false for non-JSON discovery responses without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(200, "<html>not json</html>", "text/html"));

    const client = new ModelDiscoveryClient(clientOptions(fetchImpl));
    const result = await client.listModels();

    expect(result.supported).toBe(false);
    if (result.supported) return;
    expect(result.reason.toLowerCase()).toMatch(/json|parse|unsupported|unavailable/);
  });

  it("returns supported:false when the listing shape is missing data[]", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(200, { models: [{ name: "x" }] }));

    const client = new ModelDiscoveryClient(clientOptions(fetchImpl));
    const result = await client.listModels();

    expect(result.supported).toBe(false);
    if (result.supported) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("throws AuthProviderError on 401 without leaking the API key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(401, { error: { message: `Unauthorized key ${apiKey}` } })
    );

    const client = new ModelDiscoveryClient(clientOptions(fetchImpl));
    try {
      await client.listModels();
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthProviderError);
      expect((error as AuthProviderError).kind).toBe("Auth");
      const serialized = JSON.stringify((error as AuthProviderError).redactedDetails);
      expect(serialized).not.toContain(apiKey);
      expect((error as AuthProviderError).message).not.toContain(apiKey);
    }
  });

  it("throws AuthProviderError on 403", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(403, { error: { message: "forbidden" } }));

    const client = new ModelDiscoveryClient(clientOptions(fetchImpl));
    await expect(client.listModels()).rejects.toBeInstanceOf(AuthProviderError);
  });

  it("throws EndpointNotFoundProviderError on 404 naming the endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(404, { error: { message: "not found" } }));

    const client = new ModelDiscoveryClient(clientOptions(fetchImpl));
    try {
      await client.listModels();
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EndpointNotFoundProviderError);
      const typed = error as EndpointNotFoundProviderError;
      expect(typed.endpoint).toBe("https://test.example.com/v1");
      expect(typed.message).toContain("https://test.example.com/v1");
    }
  });

  it("maps network failures to MalformedOutputProviderError without leaking secrets", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(`connect failed for key ${apiKey}`));

    const client = new ModelDiscoveryClient(clientOptions(fetchImpl));
    try {
      await client.listModels();
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(MalformedOutputProviderError);
      const serialized = `${(error as Error).message}${JSON.stringify(
        (error as MalformedOutputProviderError).redactedDetails
      )}`;
      expect(serialized).not.toContain(apiKey);
    }
  });
});

describe("ModelDiscoveryClient.testConnection", () => {
  it("resolves when GET /models succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(200, { data: [{ id: "m1" }] }));

    const client = new ModelDiscoveryClient(clientOptions(fetchImpl));
    await expect(client.testConnection()).resolves.toBeUndefined();
  });

  it("throws AuthProviderError when the key is rejected", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(401, { error: "nope" }));

    const client = new ModelDiscoveryClient(clientOptions(fetchImpl));
    await expect(client.testConnection()).rejects.toBeInstanceOf(AuthProviderError);
  });
});
