import type { DiscoveredModel } from "./model-discovery.js";
import type { VisionProviderId } from "./presets.js";

/**
 * Curated vision capability hints used when `/models` metadata lacks modalities.
 * Keys are lowercased model ids (Gemini ids without `models/` prefix).
 *
 * Ollama Cloud: live listing (2026-07-29) has no modality fields; beta evidence
 * shows minimax-m3 accepts images and glm-5.2 does not.
 */
const CURATED_VISION_HINTS: Readonly<Record<VisionProviderId, Readonly<Record<string, boolean>>>> =
  {
    ollama: {
      "minimax-m3": true,
      "glm-5.2": false,
      "glm-5.1": false
    },
    openrouter: {
      // OpenRouter usually exposes input_modalities; keep a few common fallbacks.
      "openai/gpt-4o": true,
      "openai/gpt-4o-mini": true,
      "openai/gpt-4-turbo": true
    },
    gemini: {
      "gemini-2.0-flash": true,
      "gemini-1.5-flash": true,
      "gemini-1.5-pro": true,
      "gemini-2.0-flash-lite": true
    }
  };

export type ResolveVisionHintInput = {
  providerId: VisionProviderId;
  modelId: string;
  /** Capability from discovery metadata; null when unknown. */
  discoveredVision: boolean | null;
};

/**
 * Resolve tri-state vision capability: endpoint metadata wins; else curated hints;
 * else null (unknown). Never blocks selection — callers should warn only.
 */
export function resolveVisionHint(input: ResolveVisionHintInput): boolean | null {
  if (input.discoveredVision === true || input.discoveredVision === false) {
    return input.discoveredVision;
  }

  const curated = CURATED_VISION_HINTS[input.providerId];
  const key = input.modelId.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(curated, key)) {
    return curated[key] ?? null;
  }
  // Gemini listings may still carry models/ prefix before normalize; tolerate it.
  if (input.providerId === "gemini" && key.startsWith("models/")) {
    const stripped = key.slice("models/".length);
    if (Object.prototype.hasOwnProperty.call(curated, stripped)) {
      return curated[stripped] ?? null;
    }
  }
  return null;
}

/** Annotate discovered models with curated hints where vision is still null. */
export function annotateModelsWithVisionHints(
  providerId: VisionProviderId,
  models: readonly DiscoveredModel[]
): DiscoveredModel[] {
  return models.map((model) => ({
    id: model.id,
    vision: resolveVisionHint({
      providerId,
      modelId: model.id,
      discoveredVision: model.vision
    })
  }));
}

/**
 * Human-readable guidance for a model. Warnings must not imply hard blocks.
 */
export function describeVisionHint(model: DiscoveredModel): string {
  if (model.vision === true) {
    return `Recommended: ${model.id} supports image/vision input.`;
  }
  if (model.vision === false) {
    return `Warning: ${model.id} may not accept image input (likely text-only / non-vision). Selection is still allowed.`;
  }
  return `Warning: vision capability for ${model.id} is unknown; the model may not accept image input.`;
}
