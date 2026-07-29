export type VisionProviderId = "ollama" | "openrouter" | "gemini";

export type VisionProviderPreset = {
  id: VisionProviderId;
  label: string;
  endpoint: string;
  defaultModel: string;
};

export const VISION_PROVIDER_PRESETS: Record<VisionProviderId, VisionProviderPreset> = {
  ollama: {
    id: "ollama",
    label: "Ollama Cloud",
    endpoint: "https://ollama.com/v1",
    // Live GET https://ollama.com/v1/models (2026-07-29, metadata only):
    // llama3.2-vision absent; minimax-m3 present. Beta evidence: minimax-m3
    // accepts image input (glm-5.2 does not). Chat completions returned 401
    // with the configured key, so chat reachability could not be re-probed.
    defaultModel: "minimax-m3"
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini"
  },
  gemini: {
    id: "gemini",
    label: "Gemini OpenAI-compatible",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash"
  }
};

export function getVisionProviderPreset(id: VisionProviderId): VisionProviderPreset {
  return VISION_PROVIDER_PRESETS[id];
}
