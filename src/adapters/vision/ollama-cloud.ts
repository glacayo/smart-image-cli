import { parseImageAnalysis } from "../../domain/analysis-schema.js";
import { defaultSecretRedactor, type SecretRedactor } from "../secret-redactor.js";
import {
  AuthProviderError,
  EndpointNotFoundProviderError,
  MalformedOutputProviderError,
  ModelNotFoundProviderError,
  RateLimitProviderError,
  TimeoutProviderError,
  type VisionInput,
  type VisionProvider,
  type VisionProviderError
} from "./provider.js";
import { stripJsonFence } from "./openai-compat-transport.js";

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
  error?: unknown;
};

export type OllamaCloudVisionOptions = {
  id: string;
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  redactor?: SecretRedactor;
  fetchImpl?: typeof fetch;
};

export class OllamaCloudVisionProvider implements VisionProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly redactor: SecretRedactor;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaCloudVisionOptions) {
    this.id = options.id;
    this.endpoint = resolveOllamaApiEndpoint(options.endpoint);
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.redactor = options.redactor ?? defaultSecretRedactor;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async analyze(input: VisionInput) {
    const response = await postOllamaChat({
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      model: this.model,
      body: this.requestBody(input),
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      redactor: this.redactor
    });

    return parseOllamaAnalysis(response, this.redactor);
  }

  private requestBody(input: VisionInput): unknown {
    return {
      model: this.model,
      stream: false,
      messages: [
        {
          role: "user",
          content: input.prompt,
          images: [input.imageBytes.toString("base64")]
        }
      ]
    };
  }
}

export async function probeOllamaChat(options: {
  endpoint: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  redactor?: SecretRedactor;
}): Promise<void> {
  await postOllamaChat({
    endpoint: resolveOllamaApiEndpoint(options.endpoint),
    apiKey: options.apiKey,
    model: options.model,
    body: {
      model: options.model,
      stream: false,
      messages: [{ role: "user", content: "Reply with OK." }]
    },
    timeoutMs: 15_000,
    fetchImpl: options.fetchImpl ?? fetch,
    redactor: options.redactor ?? defaultSecretRedactor
  });
}

export function resolveOllamaApiEndpoint(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed.slice(0, -3)}/api`;
  }
  if (trimmed === "https://ollama.com" || trimmed === "https://ollama.com/v1") {
    return "https://ollama.com/api";
  }
  if (trimmed === "http://localhost:11434" || trimmed === "http://localhost:11434/v1") {
    return "http://localhost:11434/api";
  }
  return trimmed;
}

async function postOllamaChat(options: {
  endpoint: string;
  apiKey: string;
  model: string;
  body: unknown;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  redactor: SecretRedactor;
}): Promise<OllamaChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await options.fetchImpl(`${options.endpoint}/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify(options.body)
    });

    const bodyText = await response.text();
    if (response.status === 429) {
      throw new RateLimitProviderError("Ollama chat rate limit", redact(options, bodyText));
    }
    if (!response.ok) {
      throw classifyOllamaHttpError(response.status, bodyText, options);
    }

    try {
      return JSON.parse(bodyText) as OllamaChatResponse;
    } catch (error) {
      throw new MalformedOutputProviderError(
        "Ollama chat returned non-JSON response",
        redact(options, bodyText),
        {
          cause: error
        }
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new TimeoutProviderError("Ollama chat request timed out", undefined, { cause: error });
    }
    if (isKnownProviderError(error)) throw error;
    throw new MalformedOutputProviderError("Ollama chat request failed", redact(options, error), {
      cause: error
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseOllamaAnalysis(response: OllamaChatResponse, redactor: SecretRedactor) {
  if (response.error !== undefined) {
    throw new MalformedOutputProviderError(
      "Ollama chat returned an error body",
      redactor.maskValue(response.error)
    );
  }

  const content = response.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new MalformedOutputProviderError(
      "Ollama chat response had no message content",
      redactor.maskValue(response)
    );
  }

  try {
    return parseImageAnalysis(JSON.parse(stripJsonFence(content)));
  } catch (error) {
    throw new MalformedOutputProviderError(
      "Ollama chat returned invalid analysis JSON",
      redactor.maskValue(content),
      { cause: error }
    );
  }
}

function classifyOllamaHttpError(
  status: number,
  bodyText: string,
  options: { endpoint: string; model: string; redactor: SecretRedactor }
): VisionProviderError {
  const redacted = redact(options, bodyText);
  if (status === 401 || status === 403) {
    return new AuthProviderError(
      "Ollama chat authentication failed. Verify that OLLAMA_API_KEY can run inference, not only list models.",
      redacted
    );
  }
  if (status === 404) {
    if (bodyText.toLowerCase().includes("model")) {
      return new ModelNotFoundProviderError(
        `Model "${options.model}" was not found. Run \`img config setup\` to choose an available model.`,
        options.model,
        redacted
      );
    }
    return new EndpointNotFoundProviderError(
      `Ollama API endpoint was not found: ${options.endpoint}`,
      options.endpoint,
      redacted
    );
  }
  return new MalformedOutputProviderError(`Ollama chat returned HTTP ${status}`, redacted);
}

function redact(options: { redactor: SecretRedactor }, value: unknown): unknown {
  return options.redactor.maskValue(value);
}

function isKnownProviderError(error: unknown): error is VisionProviderError {
  return error instanceof Error && error.name.endsWith("ProviderError");
}
