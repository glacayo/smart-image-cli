import type { SecretRedactor } from "../secret-redactor.js";
import {
  AuthProviderError,
  EndpointNotFoundProviderError,
  MalformedOutputProviderError,
  ModelNotFoundProviderError,
  RateLimitProviderError,
  RefusalProviderError,
  TimeoutProviderError,
  type VisionProviderError
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
  /** Optional explicit model id used in ModelNotFound messages. */
  model?: string;
  authErrorMessage?: string;
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
      throw classifyHttpError(response.status, bodyText, options);
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

function classifyHttpError(
  status: number,
  bodyText: string,
  options: ChatCompletionTransportOptions
): VisionProviderError {
  const redacted = redact(options, bodyText);

  if (status === 401 || status === 403) {
    return new AuthProviderError(
      options.authErrorMessage ?? "Provider authentication failed",
      redacted
    );
  }

  if (status === 404) {
    const model = resolveModelId(options);
    if (looksLikeModelNotFound(bodyText)) {
      const namedModel = model ?? extractModelNameFromBody(bodyText) ?? "unknown";
      return new ModelNotFoundProviderError(
        `Model "${namedModel}" was not found. Run \`img config setup\` to choose an available model.`,
        namedModel,
        redacted
      );
    }
    return new EndpointNotFoundProviderError(
      `Provider endpoint was not found: ${options.endpoint}`,
      options.endpoint,
      redacted
    );
  }

  return new MalformedOutputProviderError(options.httpErrorMessage(status), redacted);
}

function resolveModelId(options: ChatCompletionTransportOptions): string | undefined {
  if (typeof options.model === "string" && options.model.length > 0) {
    return options.model;
  }
  if (options.body !== null && typeof options.body === "object" && "model" in options.body) {
    const model = (options.body as { model?: unknown }).model;
    if (typeof model === "string" && model.length > 0) return model;
  }
  return undefined;
}

function looksLikeModelNotFound(bodyText: string): boolean {
  const parsed = tryParseJson(bodyText);
  if (parsed !== null) {
    const err = (parsed as { error?: unknown }).error;
    if (typeof err === "string") {
      return mentionsMissingModel(err);
    }
    if (err !== null && typeof err === "object") {
      const record = err as {
        code?: unknown;
        type?: unknown;
        message?: unknown;
        param?: unknown;
      };
      const code = stringifyField(record.code).toLowerCase();
      const type = stringifyField(record.type).toLowerCase();
      const param = stringifyField(record.param).toLowerCase();
      const message = stringifyField(record.message);

      if (code === "model_not_found" || code.includes("model_not_found")) return true;
      if (param === "model" && (code.includes("not_found") || type.includes("not_found"))) {
        return true;
      }
      if (param === "model" && mentionsMissingModel(message)) return true;
      if (mentionsMissingModel(message)) return true;
      if (code.includes("model") && (code.includes("not_found") || type.includes("not_found"))) {
        return true;
      }
    }
  }

  return mentionsMissingModel(bodyText);
}

function mentionsMissingModel(text: string): boolean {
  const lower = text.toLowerCase();
  if (!lower.includes("model")) return false;
  return (
    lower.includes("not found") ||
    lower.includes("does not exist") ||
    lower.includes("unknown model") ||
    lower.includes("no such model") ||
    lower.includes("model_not_found")
  );
}

function extractModelNameFromBody(bodyText: string): string | undefined {
  const parsed = tryParseJson(bodyText);
  if (parsed === null) return undefined;
  const err = (parsed as { error?: unknown }).error;
  if (err === null || typeof err !== "object") return undefined;
  const message = stringifyField((err as { message?: unknown }).message);
  const tick = message.match(/`([^`]+)`/);
  if (tick?.[1]) return tick[1];
  const quoted = message.match(/"([^"]+)"/);
  if (quoted?.[1]) return quoted[1];
  return undefined;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function stringifyField(value: unknown): string {
  return typeof value === "string" ? value : "";
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
    error instanceof TimeoutProviderError ||
    error instanceof AuthProviderError ||
    error instanceof ModelNotFoundProviderError ||
    error instanceof EndpointNotFoundProviderError
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
