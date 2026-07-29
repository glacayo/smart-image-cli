import { describe, expect, it, vi } from "vitest";
import { postChatCompletion } from "../../../src/adapters/vision/openai-compat-transport.js";
import {
  AuthProviderError,
  EndpointNotFoundProviderError,
  MalformedOutputProviderError,
  ModelNotFoundProviderError,
  RateLimitProviderError
} from "../../../src/adapters/vision/provider.js";
import { defaultSecretRedactor } from "../../../src/adapters/secret-redactor.js";

// Build the test secret at runtime so no provider-shaped literal is committed.
const apiKey = ["sk", "test", "transport12345678901234567890"].join("-");

function makeResponse(status: number, body: unknown, contentType = "application/json"): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": contentType }
  });
}

function transportOptions(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return {
    endpoint: "https://test.example.com/v1",
    apiKey,
    body: { model: "test-model", messages: [] },
    timeoutMs: 5_000,
    fetchImpl,
    redactor: defaultSecretRedactor,
    rateLimitMessage: "Vision provider rate limit",
    httpErrorMessage: (status: number) => `Vision provider returned HTTP ${status}`,
    nonJsonMessage: "Vision provider returned non-JSON response",
    requestFailedMessage: "Vision provider request failed",
    ...overrides
  };
}

describe("postChatCompletion typed HTTP classification", () => {
  it("maps HTTP 401 to AuthProviderError without leaking the API key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(401, { error: { message: `Unauthorized key ${apiKey}` } })
    );

    try {
      await postChatCompletion(transportOptions(fetchImpl));
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthProviderError);
      expect((error as AuthProviderError).kind).toBe("Auth");
      const serialized = JSON.stringify((error as AuthProviderError).redactedDetails);
      expect(serialized).not.toContain(apiKey);
      expect((error as AuthProviderError).message.toLowerCase()).toMatch(/auth/);
    }
  });

  it("maps HTTP 403 to AuthProviderError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(403, { error: { message: "forbidden" } })
    );

    await expect(postChatCompletion(transportOptions(fetchImpl))).rejects.toBeInstanceOf(
      AuthProviderError
    );
  });

  it("maps HTTP 404 model_not_found body to ModelNotFoundProviderError naming the model", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(404, {
        error: {
          message: "The model `missing-vision` does not exist",
          type: "invalid_request_error",
          code: "model_not_found",
          param: "model"
        }
      })
    );

    try {
      await postChatCompletion(
        transportOptions(fetchImpl, {
          body: { model: "missing-vision", messages: [] },
          model: "missing-vision"
        })
      );
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelNotFoundProviderError);
      expect(error).not.toBeInstanceOf(MalformedOutputProviderError);
      const typed = error as ModelNotFoundProviderError;
      expect(typed.kind).toBe("ModelNotFound");
      expect(typed.model).toBe("missing-vision");
      expect(typed.message).toContain("missing-vision");
      expect(typed.message.toLowerCase()).toMatch(/config setup|setup/);
      const serialized = JSON.stringify(typed.redactedDetails);
      expect(serialized).not.toContain(apiKey);
    }
  });

  it("maps HTTP 404 without model signal to EndpointNotFoundProviderError naming the endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(404, { error: { message: "no route matched", code: "not_found" } })
    );

    try {
      await postChatCompletion(transportOptions(fetchImpl));
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EndpointNotFoundProviderError);
      expect(error).not.toBeInstanceOf(ModelNotFoundProviderError);
      const typed = error as EndpointNotFoundProviderError;
      expect(typed.kind).toBe("EndpointNotFound");
      expect(typed.endpoint).toBe("https://test.example.com/v1");
      expect(typed.message).toContain("https://test.example.com/v1");
    }
  });

  it("maps HTTP 404 plain HTML body to EndpointNotFoundProviderError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(404, "<html><body>Not Found</body></html>", "text/html")
    );

    await expect(postChatCompletion(transportOptions(fetchImpl))).rejects.toBeInstanceOf(
      EndpointNotFoundProviderError
    );
  });

  it("still maps HTTP 429 to RateLimitProviderError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(429, { error: "rate limited" }));

    await expect(postChatCompletion(transportOptions(fetchImpl))).rejects.toBeInstanceOf(
      RateLimitProviderError
    );
  });

  it("maps other HTTP errors to MalformedOutputProviderError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(500, { error: "boom" }));

    await expect(postChatCompletion(transportOptions(fetchImpl))).rejects.toBeInstanceOf(
      MalformedOutputProviderError
    );
  });

  it("infers model id from request body when model option is omitted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(404, {
        error: {
          message: "model not found",
          code: "model_not_found"
        }
      })
    );

    try {
      await postChatCompletion(
        transportOptions(fetchImpl, {
          body: { model: "body-model-id", messages: [] }
        })
      );
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelNotFoundProviderError);
      expect((error as ModelNotFoundProviderError).model).toBe("body-model-id");
      expect((error as ModelNotFoundProviderError).message).toContain("body-model-id");
    }
  });
});
