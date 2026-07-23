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
    defaultModel: "llama3.2-vision"
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
