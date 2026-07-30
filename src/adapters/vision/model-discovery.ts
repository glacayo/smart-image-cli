import { defaultSecretRedactor, type SecretRedactor } from "../secret-redactor.js";
import type { VisionProviderId } from "./presets.js";
import {
  AuthProviderError,
  EndpointNotFoundProviderError,
  MalformedOutputProviderError,
  RateLimitProviderError,
  TimeoutProviderError,
  type VisionProviderError
} from "./provider.js";

export type DiscoveredModel = {
  id: string;
  /** true/false when provider metadata exposes capability; null when unknown. */
  vision: boolean | null;
};

export type ListModelsResult =
  | { supported: true; models: DiscoveredModel[] }
  | { supported: false; reason: string };

export type ModelDiscoveryClientOptions = {
  providerId: VisionProviderId;
  endpoint: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  redactor?: SecretRedactor;
};

type FetchModelsOutcome =
  | { ok: true; body: unknown }
  | { ok: false; kind: "non_json"; bodyText: string };

/**
 * OpenAI-compatible GET `{endpoint}/models` discovery client.
 * Metadata-only — never sends image bytes or chat completion payloads.
 */
export class ModelDiscoveryClient {
  readonly providerId: VisionProviderId;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly redactor: SecretRedactor;

  constructor(options: ModelDiscoveryClientOptions) {
    this.providerId = options.providerId;
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.redactor = options.redactor ?? defaultSecretRedactor;
  }

  async listModels(): Promise<ListModelsResult> {
    const outcome = await this.fetchModels();
    if (!outcome.ok) {
      return { supported: false, reason: "Model discovery returned non-JSON response" };
    }
    return normalizeModelsListing(outcome.body, this.providerId);
  }

  /** Validates key/endpoint reachability via GET /models. Throws typed errors. */
  async testConnection(): Promise<void> {
    // HTTP success is enough for a connection/key test even if the body is unusable.
    await this.fetchModels();
  }

  private async fetchModels(): Promise<FetchModelsOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.endpoint}/models`, {
        method: "GET",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: "application/json"
        }
      });

      const bodyText = await response.text();
      if (response.status === 429) {
        throw new RateLimitProviderError("Model discovery rate limit", this.redact(bodyText));
      }
      if (!response.ok) {
        throw this.classifyHttpError(response.status, bodyText);
      }

      try {
        return { ok: true, body: JSON.parse(bodyText) as unknown };
      } catch {
        return { ok: false, kind: "non_json", bodyText };
      }
    } catch (error) {
      if (isKnownProviderError(error)) throw error;
      if (isAbortError(error)) {
        throw new TimeoutProviderError("Model discovery request timed out", undefined, {
          cause: error
        });
      }
      throw new MalformedOutputProviderError(
        "Model discovery request failed",
        this.redact(error),
        { cause: error }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private classifyHttpError(status: number, bodyText: string): VisionProviderError {
    const redacted = this.redact(bodyText);
    if (status === 401 || status === 403) {
      return new AuthProviderError("Model discovery authentication failed", redacted);
    }
    if (status === 404) {
      return new EndpointNotFoundProviderError(
        `Provider endpoint was not found: ${this.endpoint}`,
        this.endpoint,
        redacted
      );
    }
    return new MalformedOutputProviderError(`Model discovery returned HTTP ${status}`, redacted);
  }

  private redact(value: unknown): unknown {
    return this.redactor.maskValue(value);
  }
}

export function normalizeModelsListing(
  body: unknown,
  providerId: VisionProviderId
): ListModelsResult {
  try {
    const data = extractDataArray(body);
    if (data === null) {
      return {
        supported: false,
        reason: "Model discovery response missing OpenAI-compatible data array"
      };
    }

    const models: DiscoveredModel[] = [];
    for (const entry of data) {
      const id = normalizeModelId(extractModelId(entry), providerId);
      if (id === null) continue;
      models.push({
        id,
        vision: extractVisionCapability(entry)
      });
    }

    if (models.length === 0) {
      return {
        supported: false,
        reason: "Model discovery response contained no usable model ids"
      };
    }

    return { supported: true, models };
  } catch {
    return { supported: false, reason: "Model discovery response could not be normalized" };
  }
}

function extractDataArray(body: unknown): unknown[] | null {
  if (body === null || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  return data;
}

function extractModelId(entry: unknown): string | null {
  if (entry === null || typeof entry !== "object") return null;
  const id = (entry as { id?: unknown }).id;
  if (typeof id !== "string" || id.trim().length === 0) return null;
  return id.trim();
}

function normalizeModelId(id: string | null, providerId: VisionProviderId): string | null {
  if (id === null) return null;
  if (providerId === "gemini" && id.startsWith("models/")) {
    return id.slice("models/".length);
  }
  return id;
}

function extractVisionCapability(entry: unknown): boolean | null {
  if (entry === null || typeof entry !== "object") return null;
  const record = entry as {
    architecture?: { input_modalities?: unknown };
    input_modalities?: unknown;
    vision?: unknown;
  };

  if (typeof record.vision === "boolean") return record.vision;

  const modalities = record.architecture?.input_modalities ?? record.input_modalities ?? null;
  if (!Array.isArray(modalities)) return null;

  const normalized = modalities
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.toLowerCase());

  if (normalized.length === 0) return null;
  if (normalized.some((m) => m === "image" || m === "vision")) return true;
  // Explicit modalities list without image ⇒ not vision-capable.
  return false;
}

function isKnownProviderError(error: unknown): boolean {
  return (
    error instanceof RateLimitProviderError ||
    error instanceof MalformedOutputProviderError ||
    error instanceof TimeoutProviderError ||
    error instanceof AuthProviderError ||
    error instanceof EndpointNotFoundProviderError
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
