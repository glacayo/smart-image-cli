import { parseImageAnalysis } from "../../domain/analysis-schema.js";
import { defaultSecretRedactor, type SecretRedactor } from "../secret-redactor.js";
import {
  MalformedOutputProviderError,
  RateLimitProviderError,
  RefusalProviderError,
  TimeoutProviderError,
  type VisionInput,
  type VisionProvider
} from "./provider.js";

export type OpenAICompatVisionOptions = {
  id: string;
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  redactor?: SecretRedactor;
  fetchImpl?: typeof fetch;
};

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      refusal?: string;
    };
  }>;
  error?: unknown;
};

type ChatMessageContent = NonNullable<
  NonNullable<ChatCompletionResponse["choices"]>[number]["message"]
>["content"];

export class OpenAICompatVisionProvider implements VisionProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly redactor: SecretRedactor;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatVisionOptions) {
    this.id = options.id;
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.redactor = options.redactor ?? defaultSecretRedactor;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async analyze(input: VisionInput) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.endpoint}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(this.requestBody(input))
      });

      const bodyText = await response.text();
      if (response.status === 429) {
        throw new RateLimitProviderError("Vision provider rate limit", this.redact(bodyText));
      }
      if (!response.ok) {
        throw new MalformedOutputProviderError(
          `Vision provider returned HTTP ${response.status}`,
          this.redact(bodyText)
        );
      }

      return this.parseResponse(bodyText);
    } catch (error) {
      if (
        error instanceof RateLimitProviderError ||
        error instanceof MalformedOutputProviderError ||
        error instanceof RefusalProviderError ||
        error instanceof TimeoutProviderError
      ) {
        throw error;
      }
      if (isAbortError(error)) {
        throw new TimeoutProviderError("Vision provider request timed out", undefined, {
          cause: error
        });
      }
      throw new MalformedOutputProviderError("Vision provider request failed", this.redact(error), {
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private requestBody(input: VisionInput): unknown {
    return {
      model: this.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${input.mimeType};base64,${input.imageBytes.toString("base64")}`
              }
            }
          ]
        }
      ]
    };
  }

  private parseResponse(bodyText: string) {
    let body: ChatCompletionResponse;
    try {
      body = JSON.parse(bodyText) as ChatCompletionResponse;
    } catch (error) {
      throw new MalformedOutputProviderError(
        "Vision provider returned non-JSON response",
        this.redact(bodyText),
        {
          cause: error
        }
      );
    }

    if (body.error !== undefined) {
      throw new MalformedOutputProviderError(
        "Vision provider returned an error body",
        this.redact(body.error)
      );
    }

    const choice = body.choices?.[0];
    const refusal = choice?.message?.refusal;
    if (
      choice?.finish_reason === "content_filter" ||
      (refusal !== undefined && refusal.length > 0)
    ) {
      throw new RefusalProviderError(
        "Vision provider refused image analysis",
        this.redact(refusal ?? body)
      );
    }

    const content = extractTextContent(choice?.message?.content);
    if (content === null) {
      throw new MalformedOutputProviderError(
        "Vision provider response had no text content",
        this.redact(body)
      );
    }

    try {
      return parseImageAnalysis(JSON.parse(stripJsonFence(content)));
    } catch (error) {
      throw new MalformedOutputProviderError(
        "Vision provider returned invalid analysis JSON",
        this.redact(content),
        {
          cause: error
        }
      );
    }
  }

  private redact(value: unknown): unknown {
    return this.redactor.maskValue(value);
  }
}

function extractTextContent(content: ChatMessageContent): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is { type?: string; text: string } =>
          part.type === "text" && typeof part.text === "string"
      )
      .map((part) => part.text)
      .join("\n");
  }
  return null;
}

function stripJsonFence(content: string): string {
  return content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
