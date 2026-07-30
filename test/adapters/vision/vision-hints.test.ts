import { describe, expect, it } from "vitest";
import {
  annotateModelsWithVisionHints,
  describeVisionHint,
  resolveVisionHint
} from "../../../src/adapters/vision/vision-hints.js";
import type { DiscoveredModel } from "../../../src/adapters/vision/model-discovery.js";

describe("resolveVisionHint", () => {
  it("returns true when discovery metadata already marks vision true", () => {
    expect(
      resolveVisionHint({
        providerId: "openrouter",
        modelId: "openai/gpt-4o-mini",
        discoveredVision: true
      })
    ).toBe(true);
  });

  it("returns false when discovery metadata marks vision false", () => {
    expect(
      resolveVisionHint({
        providerId: "openrouter",
        modelId: "meta-llama/llama-3.1-8b-instruct",
        discoveredVision: false
      })
    ).toBe(false);
  });

  it("uses curated Ollama vision allowlist when metadata is null", () => {
    expect(
      resolveVisionHint({
        providerId: "ollama",
        modelId: "minimax-m3",
        discoveredVision: null
      })
    ).toBe(true);

    expect(
      resolveVisionHint({
        providerId: "ollama",
        modelId: "glm-5.2",
        discoveredVision: null
      })
    ).toBe(false);
  });

  it("treats known Gemini flash/pro defaults as vision-capable when metadata is null", () => {
    expect(
      resolveVisionHint({
        providerId: "gemini",
        modelId: "gemini-2.0-flash",
        discoveredVision: null
      })
    ).toBe(true);
  });

  it("returns null for unknown models without metadata or curated match", () => {
    expect(
      resolveVisionHint({
        providerId: "ollama",
        modelId: "totally-unknown-model-xyz",
        discoveredVision: null
      })
    ).toBeNull();
  });

  it("prefers endpoint metadata over curated hints", () => {
    // Even if curated might say otherwise, explicit false from endpoint wins.
    expect(
      resolveVisionHint({
        providerId: "ollama",
        modelId: "minimax-m3",
        discoveredVision: false
      })
    ).toBe(false);
  });
});

describe("annotateModelsWithVisionHints", () => {
  it("fills null vision from curated hints without mutating input", () => {
    const input: DiscoveredModel[] = [
      { id: "minimax-m3", vision: null },
      { id: "openai/gpt-4o-mini", vision: true },
      { id: "text-only", vision: false }
    ];

    const annotated = annotateModelsWithVisionHints("ollama", input);

    expect(annotated).toEqual([
      { id: "minimax-m3", vision: true },
      { id: "openai/gpt-4o-mini", vision: true },
      { id: "text-only", vision: false }
    ]);
    expect(input[0]?.vision).toBeNull();
  });
});

describe("describeVisionHint", () => {
  it("flags vision-capable models as recommended", () => {
    const message = describeVisionHint({ id: "minimax-m3", vision: true });
    expect(message.toLowerCase()).toMatch(/vision|image|recommended/);
  });

  it("warns for non-vision models without blocking language", () => {
    const message = describeVisionHint({ id: "glm-5.2", vision: false });
    expect(message.toLowerCase()).toMatch(/may not|warn|not accept|no image|non-vision|text-only/);
    expect(message.toLowerCase()).not.toMatch(/blocked|cannot select|must not/);
  });

  it("warns for unknown vision capability", () => {
    const message = describeVisionHint({ id: "mystery-model", vision: null });
    expect(message.toLowerCase()).toMatch(/unknown|unclear|may not|warn/);
  });
});
