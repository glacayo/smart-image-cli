import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTextRankerProvider } from "../../src/app/runtime.js";
import { getUserConfigPath } from "../../src/config/user-config.js";
import type { RankingCandidateMeta } from "../../src/adapters/vision/provider.js";
import { rmWithRetry } from "../support/cleanup.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(roots.map((root) => rmWithRetry(root)));
  roots.length = 0;
});

describe("buildTextRankerProvider", () => {
  it("uses project provider/model precedence but keeps the trusted user endpoint/key boundary", async () => {
    const root = await tempRoot();
    await writeUserConfig({
      activeProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          endpoint: "https://user-ollama.example/v1",
          model: "ollama-user-model",
          apiKey: "ollama-user-key"
        },
        openrouter: {
          provider: "openrouter",
          endpoint: "https://user-openrouter.example/v1/",
          model: "openrouter-user-model",
          apiKey: "openrouter-user-key"
        }
      }
    });
    await writeProjectConfig(root, {
      provider: { provider: "openrouter", model: "project-model" }
    });
    const fetchImpl = successfulFetch(candidate(1));
    vi.stubGlobal("fetch", fetchImpl);

    const provider = await buildTextRankerProvider(root);
    await provider.rank("bright shower", [candidate(1)]);

    expect(provider.id).toBe("openrouter");
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://user-openrouter.example/v1/chat/completions");
    expect((fetchImpl.mock.calls[0]![1].headers as Record<string, string>).authorization).toBe(
      "Bearer openrouter-user-key"
    );
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body.model).toBe("project-model");
    expect(JSON.stringify(body)).not.toContain("image_url");
    expect(JSON.stringify(body)).not.toContain("data:image");
    expect(JSON.stringify(body)).not.toContain("base64");
  });

  it("falls back to provider presets when user config has only the API key", async () => {
    const root = await tempRoot();
    await writeUserConfig({
      activeProvider: "gemini",
      providers: { gemini: { provider: "gemini", apiKey: "gemini-user-key" } }
    });
    const fetchImpl = successfulFetch(candidate(1));
    vi.stubGlobal("fetch", fetchImpl);

    const provider = await buildTextRankerProvider(root);
    await provider.rank("query", [candidate(1)]);

    expect(provider.id).toBe("gemini");
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    );
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(body.model).toBe("gemini-2.0-flash");
  });

  it("fails loudly when the selected provider has no user API key", async () => {
    const root = await tempRoot();
    await writeUserConfig({ activeProvider: "openrouter", providers: {} });

    await expect(buildTextRankerProvider(root)).rejects.toThrow(
      "Missing per-user API key for provider: openrouter"
    );
  });

  it("rejects project-controlled custom endpoints for text ranking", async () => {
    const root = await tempRoot();
    await writeUserConfig({
      activeProvider: "openrouter",
      providers: {
        openrouter: {
          provider: "openrouter",
          endpoint: "https://trusted-user-endpoint.example/v1",
          apiKey: "openrouter-user-key"
        }
      }
    });
    await writeProjectConfig(root, {
      provider: { provider: "openrouter", endpoint: "https://project-controlled.example/v1" }
    });

    await expect(buildTextRankerProvider(root)).rejects.toThrow("not trusted for text ranking");
  });
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-runtime-"));
  roots.push(root);
  return root;
}

async function writeUserConfig(value: unknown): Promise<void> {
  const configHome = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-user-config-"));
  roots.push(configHome);
  vi.stubEnv("APPDATA", configHome);
  vi.stubEnv("XDG_CONFIG_HOME", configHome);
  const configPath = getUserConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

async function writeProjectConfig(root: string, value: unknown): Promise<void> {
  const configPath = path.join(root, ".img-ia", "config.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(value)}\n`);
}

function successfulFetch(ranked: RankingCandidateMeta) {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                rankings: [{ sha256: ranked.sha256, score: 0.9, reason: "best" }]
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  );
}

function candidate(index: number): RankingCandidateMeta {
  return {
    sha256: index.toString(16).padStart(64, "0"),
    subject: `Subject ${index}`,
    title: `Title ${index}`,
    description: `Description ${index}`,
    altText: `Alt text ${index}`,
    categories: ["bathroom"]
  };
}
