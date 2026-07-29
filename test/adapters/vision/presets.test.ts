import { describe, expect, it } from "vitest";
import {
  getVisionProviderPreset,
  VISION_PROVIDER_PRESETS
} from "../../../src/adapters/vision/presets.js";

describe("VISION_PROVIDER_PRESETS defaults", () => {
  it("uses a non-broken Ollama Cloud default model id", () => {
    const ollama = getVisionProviderPreset("ollama");
    expect(ollama.defaultModel).not.toBe("llama3.2-vision");
    expect(ollama.defaultModel).toBe("minimax-m3");
    expect(VISION_PROVIDER_PRESETS.ollama.defaultModel).toBe(ollama.defaultModel);
  });

  it("keeps openrouter and gemini defaults populated", () => {
    expect(getVisionProviderPreset("openrouter").defaultModel).toBeTruthy();
    expect(getVisionProviderPreset("gemini").defaultModel).toBeTruthy();
  });
});
