import { describe, expect, it, vi } from "vitest";
import { OpenAICompatVisionProvider } from "../../src/adapters/vision/openai-compat.js";
import {
  AuthProviderError,
  MalformedOutputProviderError,
  ModelNotFoundProviderError,
  RateLimitProviderError,
  RefusalProviderError,
  TimeoutProviderError
} from "../../src/adapters/vision/provider.js";

// Build the test "API key" dynamically so the literal provider-shaped string
// (`sk-...` / `or-...`) never appears committed in source — this avoids
// secret-scanner false positives while still exercising the redactor's
// prefix-based secret masking. The value is a long alphanumeric token that the
// redactor's LONG_SECRET_VALUE regex matches because of its length and shape.
const apiKey = buildTestSecret("sk", "test", "123456789012345678901234567");

function buildTestSecret(prefix: string, label: string, tail: string): string {
  // Assembled at runtime; no single committed string is provider-shaped.
  return `${prefix}-${label}_${tail}`;
}

const validAnalysis = {
  subject: "Kitchen",
  categories: ["kitchen-remodeling"],
  orientation: "landscape",
  altText: "Kitchen",
  title: "Kitchen",
  description: "Kitchen photo",
  suggestedSlug: "kitchen"
};

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeProvider(fetchImpl: typeof fetch): OpenAICompatVisionProvider {
  return new OpenAICompatVisionProvider({
    id: "test",
    endpoint: "https://test.example.com/v1",
    model: "test-model",
    apiKey,
    timeoutMs: 5000,
    fetchImpl
  });
}

const visionInput = {
  imageBytes: Buffer.from("fake"),
  mimeType: "image/jpeg",
  prompt: "Describe this image"
};

describe("OpenAICompatVisionProvider", () => {
  it("maps HTTP 429 to RateLimitProviderError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(429, { error: "rate limited" }));
    const provider = makeProvider(fetchImpl);

    await expect(provider.analyze(visionInput)).rejects.toBeInstanceOf(RateLimitProviderError);
  });

  it("maps HTTP 401 to AuthProviderError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(401, { error: "Unauthorized" }));
    const provider = makeProvider(fetchImpl);

    await expect(provider.analyze(visionInput)).rejects.toBeInstanceOf(AuthProviderError);
  });

  it("maps HTTP 404 model_not_found to ModelNotFoundProviderError naming the model", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(404, {
        error: {
          message: "The model `test-model` does not exist",
          code: "model_not_found",
          param: "model"
        }
      })
    );
    const provider = makeProvider(fetchImpl);

    try {
      await provider.analyze(visionInput);
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelNotFoundProviderError);
      expect(error).not.toBeInstanceOf(MalformedOutputProviderError);
      const typed = error as ModelNotFoundProviderError;
      expect(typed.model).toBe("test-model");
      expect(typed.message).toContain("test-model");
      expect(typed.message.toLowerCase()).toMatch(/config setup|setup/);
      expect(JSON.stringify(typed.redactedDetails)).not.toContain(apiKey);
    }
  });

  it("maps timeout/abort to TimeoutProviderError", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    const provider = makeProvider(fetchImpl);

    await expect(provider.analyze(visionInput)).rejects.toBeInstanceOf(TimeoutProviderError);
  });

  it("maps content_filter / refusal to RefusalProviderError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, {
        choices: [
          {
            finish_reason: "content_filter",
            message: { refusal: "content blocked" }
          }
        ]
      })
    );
    const provider = makeProvider(fetchImpl);

    await expect(provider.analyze(visionInput)).rejects.toBeInstanceOf(RefusalProviderError);
  });

  it("maps non-JSON response to MalformedOutputProviderError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("not json at all", {
        status: 200,
        headers: { "content-type": "text/plain" }
      })
    );
    const provider = makeProvider(fetchImpl);

    await expect(provider.analyze(visionInput)).rejects.toBeInstanceOf(
      MalformedOutputProviderError
    );
  });

  it("maps invalid analysis schema JSON to MalformedOutputProviderError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({ wrong: "schema" })
            }
          }
        ]
      })
    );
    const provider = makeProvider(fetchImpl);

    await expect(provider.analyze(visionInput)).rejects.toBeInstanceOf(
      MalformedOutputProviderError
    );
  });

  it("redacted diagnostics do not leak the API key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(500, { error: `internal error with key ${apiKey}` })
    );
    const provider = makeProvider(fetchImpl);

    try {
      await provider.analyze(visionInput);
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(MalformedOutputProviderError);
      const redacted = (error as MalformedOutputProviderError).redactedDetails;
      const serialized = JSON.stringify(redacted);
      expect(serialized).not.toContain(apiKey);
    }
  });

  it("returns a valid analysis on a well-formed response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify(validAnalysis)
            }
          }
        ]
      })
    );
    const provider = makeProvider(fetchImpl);

    const result = await provider.analyze(visionInput);
    expect(result.subject).toBe("Kitchen");
    expect(result.categories).toEqual(["kitchen-remodeling"]);
  });

  it("parses analysis from a markdown-fenced JSON content", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, {
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "```json\n" + JSON.stringify(validAnalysis) + "\n```"
            }
          }
        ]
      })
    );
    const provider = makeProvider(fetchImpl);

    const result = await provider.analyze(visionInput);
    expect(result.subject).toBe("Kitchen");
  });
});