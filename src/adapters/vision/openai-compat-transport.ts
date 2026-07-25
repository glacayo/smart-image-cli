import type { SecretRedactor } from "../secret-redactor.js";
import {
  MalformedOutputProviderError,
  RateLimitProviderError,
  RefusalProviderError,
  TimeoutProviderError
} from "./provider.js";

export type ChatCompletionResponse = {
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

export type ChatCompletionTransportOptions = {
  endpoint: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  redactor: SecretRedactor;
  rateLimitMessage: string;
  httpErrorMessage: (status: number) => string;
  nonJsonMessage: string;
  requestFailedMessage: string;
};

export type ChatCompletionContentOptions = {
  body: ChatCompletionResponse;
  redactor: SecretRedactor;
  errorBodyMessage: string;
  refusalMessage: string;
  noTextMessage: string;
};

export async function postChatCompletion(
  options: ChatCompletionTransportOptions
): Promise<ChatCompletionResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await options.fetchImpl(`${options.endpoint}/chat/completions`, {
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
      throw new RateLimitProviderError(options.rateLimitMessage, redact(options, bodyText));
    }
    if (!response.ok) {
      throw new MalformedOutputProviderError(
        options.httpErrorMessage(response.status),
        redact(options, bodyText)
      );
    }

    try {
      return JSON.parse(bodyText) as ChatCompletionResponse;
    } catch (error) {
      throw new MalformedOutputProviderError(options.nonJsonMessage, redact(options, bodyText), {
        cause: error
      });
    }
  } catch (error) {
    if (isKnownProviderError(error)) throw error;
    if (isAbortError(error)) {
      throw new TimeoutProviderError(
        providerTimeoutMessage(options.requestFailedMessage),
        undefined,
        {
          cause: error
        }
      );
    }
    throw new MalformedOutputProviderError(options.requestFailedMessage, redact(options, error), {
      cause: error
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function extractChatCompletionText(options: ChatCompletionContentOptions): string {
  if (options.body.error !== undefined) {
    throw new MalformedOutputProviderError(
      options.errorBodyMessage,
      options.redactor.maskValue(options.body.error)
    );
  }

  const choice = options.body.choices?.[0];
  const refusal = choice?.message?.refusal;
  if (choice?.finish_reason === "content_filter" || (refusal !== undefined && refusal.length > 0)) {
    throw new RefusalProviderError(
      options.refusalMessage,
      options.redactor.maskValue(refusal ?? options.body)
    );
  }

  const content = extractTextContent(choice?.message?.content);
  if (content === null) {
    throw new MalformedOutputProviderError(
      options.noTextMessage,
      options.redactor.maskValue(options.body)
    );
  }
  return content;
}

export function stripJsonFence(content: string): string {
  return content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractTextContent(content: ChatMessageContent): string | null {
  if (typeof content === "string") return content;
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

function isKnownProviderError(error: unknown): boolean {
  return (
    error instanceof RateLimitProviderError ||
    error instanceof MalformedOutputProviderError ||
    error instanceof RefusalProviderError ||
    error instanceof TimeoutProviderError
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function redact(options: ChatCompletionTransportOptions, value: unknown): unknown {
  return options.redactor.maskValue(value);
}

function providerTimeoutMessage(requestFailedMessage: string): string {
  return requestFailedMessage.replace(/request failed$/, "request timed out");
}
