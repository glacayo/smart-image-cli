import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configService } from "../../src/app/config-service.js";

const roots: string[] = [];
const apiKey = ["sk", "test", "configmodels123456789012345"].join("-");
const badKey = ["sk", "bad", "keyvalue999999999999999999"].join("-");

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

function makeResponse(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

async function writeUserConfig(config: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-cfg-models-"));
  roots.push(dir);
  const configPath = path.join(dir, "config.json");
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

function providerCfg(overrides: Record<string, unknown> = {}, includeKey = true) {
  const ollama: Record<string, unknown> = {
    provider: "ollama",
    endpoint: "https://test.example.com/v1",
    ...overrides
  };
  if (includeKey && ollama.apiKey === undefined) ollama.apiKey = apiKey;
  if (!includeKey) delete ollama.apiKey;
  return { activeProvider: "ollama", providers: { ollama } };
}

describe("configService models action", () => {
  it("lists discovered models with vision hints as a single success JSON shape", async () => {
    const userConfigPath = await writeUserConfig(providerCfg());
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, {
        data: [{ id: "minimax-m3" }, { id: "glm-5.2" }, { id: "mystery-model" }]
      })
    );

    const outcome = await configService("models", undefined, undefined, {
      userConfigPath,
      fetchImpl
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.command).toBe("config");
    const details = outcome.result.details as {
      action: string;
      provider: string;
      endpoint: string;
      source: string;
      models: Array<{ id: string; vision: boolean | null }>;
      warnings?: string[];
    };
    expect(details).toMatchObject({
      action: "models",
      provider: "ollama",
      endpoint: "https://test.example.com/v1",
      source: "discovery"
    });
    expect(details.models).toEqual([
      { id: "minimax-m3", vision: true },
      { id: "glm-5.2", vision: false },
      { id: "mystery-model", vision: null }
    ]);
    expect(details.warnings?.some((w) => w.includes("glm-5.2"))).toBe(true);
    expect(details.warnings?.some((w) => w.includes("mystery-model"))).toBe(true);
    expect(JSON.stringify(outcome.result)).not.toContain(apiKey);
  });

  it("returns unavailable fallback when discovery body cannot be normalized", async () => {
    const userConfigPath = await writeUserConfig(providerCfg());
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(200, { models: [] }));

    const outcome = await configService("models", undefined, undefined, {
      userConfigPath,
      fetchImpl
    });

    expect(outcome.exitCode).toBe(0);
    const details = outcome.result.details as {
      source: string;
      models: unknown[];
      reason?: string;
      fallback?: string;
    };
    expect(details.source).toBe("unavailable");
    expect(details.models).toEqual([]);
    expect(details.reason).toMatch(/missing|unsupported|usable|normalized/i);
    expect(details.fallback).toMatch(/manual|model id|config setup/i);
    expect(JSON.stringify(outcome.result)).not.toContain(apiKey);
  });

  it("surfaces typed auth failure for models without leaking the key", async () => {
    const userConfigPath = await writeUserConfig(providerCfg({ apiKey: badKey }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse(401, { error: { message: `Invalid key ${badKey}` } }));

    const outcome = await configService("models", undefined, undefined, {
      userConfigPath,
      fetchImpl
    });

    expect(outcome.exitCode).toBe(4);
    expect(outcome.result.reason).toBe("provider_auth");
    expect(outcome.result.message).toMatch(/auth|credential|key/i);
    expect(JSON.stringify(outcome.result)).not.toContain(badKey);
  });

  it("surfaces typed endpoint_not_found for models 404", async () => {
    const userConfigPath = await writeUserConfig({
      activeProvider: "openrouter",
      providers: {
        openrouter: {
          provider: "openrouter",
          apiKey,
          endpoint: "https://missing.example.com/v1"
        }
      }
    });
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(404, { error: "not found" }));

    const outcome = await configService("models", undefined, undefined, {
      userConfigPath,
      fetchImpl,
      provider: "openrouter"
    });

    expect(outcome.exitCode).toBe(4);
    expect(outcome.result.reason).toBe("endpoint_not_found");
    expect(outcome.result.message).toMatch(/endpoint|not found/i);
    expect(JSON.stringify(outcome.result)).not.toContain(apiKey);
  });

  it("honors --provider and --endpoint overrides for models", async () => {
    const userConfigPath = await writeUserConfig({
      activeProvider: "ollama",
      providers: {
        ollama: { provider: "ollama", apiKey: "ollama-key-value" },
        gemini: { provider: "gemini", apiKey: "gemini-key-value" }
      }
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse(200, { data: [{ id: "models/gemini-2.0-flash" }] }));

    const outcome = await configService("models", undefined, undefined, {
      userConfigPath,
      fetchImpl,
      provider: "gemini",
      endpoint: "https://gemini.test/v1beta/openai"
    });

    expect(outcome.exitCode).toBe(0);
    const details = outcome.result.details as {
      provider: string;
      endpoint: string;
      models: Array<{ id: string; vision: boolean | null }>;
    };
    expect(details.provider).toBe("gemini");
    expect(details.endpoint).toBe("https://gemini.test/v1beta/openai");
    expect(details.models).toEqual([{ id: "gemini-2.0-flash", vision: true }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gemini.test/v1beta/openai/models",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer gemini-key-value" })
      })
    );
    const json = JSON.stringify(outcome.result);
    expect(json).not.toContain("gemini-key-value");
    expect(json).not.toContain("ollama-key-value");
  });

  it("rejects models when no API key is configured", async () => {
    const userConfigPath = await writeUserConfig({ activeProvider: "ollama", providers: {} });
    const outcome = await configService("models", undefined, undefined, {
      userConfigPath,
      fetchImpl: vi.fn()
    });
    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("invalid_input");
    expect(outcome.result.message).toMatch(/api key|apiKey|config setup/i);
  });
});

describe("configService apiKey set connection test", () => {
  it("persists user-scoped apiKey and reports connectionTest ok in JSON details", async () => {
    const userConfigPath = await writeUserConfig(providerCfg({}, false));
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse(200, { data: [{ id: "minimax-m3" }] }));

    const outcome = await configService("set", "providers.ollama.apiKey", apiKey, {
      userConfigPath,
      fetchImpl
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result.details).toMatchObject({
      scope: "user",
      key: "providers.ollama.apiKey",
      value: "[REDACTED]",
      connectionTest: { ok: true }
    });
    expect(JSON.stringify(outcome.result)).not.toContain(apiKey);
    const raw = JSON.parse(await fs.readFile(userConfigPath, "utf8")) as {
      providers: { ollama: { apiKey: string } };
    };
    expect(raw.providers.ollama.apiKey).toBe(apiKey);
  });

  it("reports connectionTest failure with typed provider_auth and still persists key", async () => {
    const userConfigPath = await writeUserConfig(providerCfg({}, false));
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse(403, { error: { message: `denied ${badKey}` } }));

    const outcome = await configService("set", "providers.ollama.apiKey", badKey, {
      userConfigPath,
      fetchImpl
    });

    const raw = JSON.parse(await fs.readFile(userConfigPath, "utf8")) as {
      providers: { ollama: { apiKey: string } };
    };
    expect(raw.providers.ollama.apiKey).toBe(badKey);
    expect(outcome.exitCode).toBe(4);
    expect(outcome.result.reason).toBe("provider_auth");
    expect(outcome.result.details).toMatchObject({
      value: "[REDACTED]",
      connectionTest: { ok: false, reason: "provider_auth" }
    });
    expect(JSON.stringify(outcome.result)).not.toContain(badKey);
  });

  it("writes connection outcome to stderr in human mode without echoing the key", async () => {
    const userConfigPath = await writeUserConfig(providerCfg({}, false));
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse(200, { data: [{ id: "minimax-m3" }] }));
    const chunks: string[] = [];
    const stderr = {
      write(chunk: string | Uint8Array): boolean {
        chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }
    } as NodeJS.WritableStream;

    const outcome = await configService("set", "providers.ollama.apiKey", apiKey, {
      userConfigPath,
      fetchImpl,
      stderr
    });

    expect(outcome.exitCode).toBe(0);
    const stderrText = chunks.join("");
    expect(stderrText).toMatch(/connection|ok|success/i);
    expect(stderrText).not.toContain(apiKey);
    expect(JSON.stringify(outcome.result)).not.toContain(apiKey);
  });

  it("does not run connection test for non-apiKey config sets", async () => {
    const userConfigPath = await writeUserConfig(providerCfg());
    const fetchImpl = vi.fn();
    const outcome = await configService("set", "providers.ollama.model", "minimax-m3", {
      userConfigPath,
      fetchImpl
    });
    expect(outcome.exitCode).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((outcome.result.details as { connectionTest?: unknown }).connectionTest).toBeUndefined();
  });
});
