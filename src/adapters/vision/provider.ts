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

export type RankingCandidateMeta = {
  sha256: string;
  subject: string;
  title: string;
  description: string;
  altText: string;
  categories: readonly string[];
};

export type RankingEntry = {
  sha256: string;
  score: number;
  reason: string;
};

/**
 * Ranks candidate metadata for semantic image selection.
 *
 * Implementations MUST return entries for input candidates only, MUST NOT emit
 * duplicate sha256 values, and SHOULD order results by descending relevance
 * with a deterministic tie-break. Partial rankings are valid: a provider MAY
 * omit candidates it did not rank (for example because of provider confidence
 * or payload caps). Phase 3 callers must treat omitted candidates as unranked
 * rather than inventing scores for them. The local ranker returns every input
 * candidate; remote rankers may return a subset.
 */
export interface TextRankerProvider {
  readonly id: string;
  rank(query: string, candidates: readonly RankingCandidateMeta[]): Promise<RankingEntry[]>;
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
