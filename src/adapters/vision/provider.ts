import type { ImageAnalysis } from "../../domain/analysis-schema.js";

export type VisionInput = {
  imageBytes: Buffer;
  mimeType: string;
  prompt: string;
};

export interface VisionProvider {
  readonly id: string;
  analyze(input: VisionInput): Promise<ImageAnalysis>;
}

export type VisionErrorKind = "RateLimit" | "Timeout" | "Refusal" | "MalformedOutput";

export class VisionProviderError extends Error {
  constructor(
    readonly kind: VisionErrorKind,
    message: string,
    readonly redactedDetails?: unknown,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = `${kind}ProviderError`;
  }
}

export class RateLimitProviderError extends VisionProviderError {
  constructor(message: string, redactedDetails?: unknown, options?: ErrorOptions) {
    super("RateLimit", message, redactedDetails, options);
  }
}

export class TimeoutProviderError extends VisionProviderError {
  constructor(message: string, redactedDetails?: unknown, options?: ErrorOptions) {
    super("Timeout", message, redactedDetails, options);
  }
}

export class RefusalProviderError extends VisionProviderError {
  constructor(message: string, redactedDetails?: unknown, options?: ErrorOptions) {
    super("Refusal", message, redactedDetails, options);
  }
}

export class MalformedOutputProviderError extends VisionProviderError {
  constructor(message: string, redactedDetails?: unknown, options?: ErrorOptions) {
    super("MalformedOutput", message, redactedDetails, options);
  }
}
