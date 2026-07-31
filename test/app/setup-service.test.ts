import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupService } from "../../src/app/setup-service.js";
import type { Prompter } from "../../src/cli/prompter.js";
import { readUserConfig, resolveProviderConfig } from "../../src/app/runtime.js";
import { getUserConfigPath } from "../../src/config/user-config.js";

const roots: string[] = [];
const apiKey = ["sk", "test", "setupwizard123456789012345"].join("-");
const badKey = ["sk", "bad", "setupkey999999999999999999"].join("-");

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

function makeResponse(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

/** Fresh Response per call — a shared Response body can only be read once. */
function fetchOk(body: unknown): typeof fetch {
  return vi.fn(async () => makeResponse(200, body)) as unknown as typeof fetch;
}

async function tempUserConfigPath(initial?: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-setup-"));
  roots.push(dir);
  const configPath = path.join(dir, "config.json");
  if (initial !== undefined) {
    await fs.writeFile(configPath, `${JSON.stringify(initial, null, 2)}\n`);
  }
  return configPath;
}

function stubPrompter(overrides: Partial<Prompter> = {}): Prompter {
  return {
    select: vi.fn(async () => "ollama"),
    input: vi.fn(async () => "minimax-m3"),
    password: vi.fn(async () => apiKey),
    confirm: vi.fn(async () => true),
    ...overrides
  };
}

describe("setupService non-interactive (non-TTY)", () => {
  it("completes happy path with flags, persists user config, and returns setup JSON shape", async () => {
    const userConfigPath = await tempUserConfigPath();
    const fetchImpl = fetchOk({ data: [{ id: "minimax-m3" }, { id: "glm-5.2" }] });

    const outcome = await setupService({
      isTty: false,
      provider: "ollama",
      apiKey,
      model: "minimax-m3",
      endpoint: "https://setup.test/v1",
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
      model: string;
      connectionTest: { ok: boolean };
      visionHint?: string;
      warnings?: string[];
    };
    expect(details).toMatchObject({
      action: "setup",
      provider: "ollama",
      endpoint: "https://setup.test/v1",
      model: "minimax-m3",
      connectionTest: { ok: true }
    });
    expect(details.visionHint).toMatch(/recommended|vision|image/i);
    expect(JSON.stringify(outcome.result)).not.toContain(apiKey);

    const persisted = await readUserConfig(userConfigPath);
    expect(persisted.activeProvider).toBe("ollama");
    expect(persisted.providers.ollama).toMatchObject({
      provider: "ollama",
      endpoint: "https://setup.test/v1",
      model: "minimax-m3",
      apiKey
    });
  });

  it("rejects incomplete non-TTY setup with exit 3 and never calls the network", async () => {
    const userConfigPath = await tempUserConfigPath();
    const fetchImpl = vi.fn();
    const prompter = stubPrompter();

    const outcome = await setupService({
      isTty: false,
      provider: "ollama",
      // missing apiKey + model
      userConfigPath,
      fetchImpl,
      prompter
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("invalid_input");
    expect(outcome.result.message).toMatch(/non-interactive|flags|--api-key|--model/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prompter.select).not.toHaveBeenCalled();
    expect(prompter.password).not.toHaveBeenCalled();
    expect(prompter.input).not.toHaveBeenCalled();
  });

  it("surfaces typed auth failure with exit 4 and does not leak the key", async () => {
    const userConfigPath = await tempUserConfigPath();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse(401, { error: { message: `Invalid key ${badKey}` } }));

    const outcome = await setupService({
      isTty: false,
      provider: "ollama",
      apiKey: badKey,
      model: "minimax-m3",
      userConfigPath,
      fetchImpl
    });

    expect(outcome.exitCode).toBe(4);
    expect(outcome.result.reason).toBe("provider_auth");
    expect(outcome.result.message).toMatch(/auth|credential|key/i);
    const blob = JSON.stringify(outcome.result);
    expect(blob).not.toContain(badKey);
    // Failed auth must not leave a half-written successful active selection without testing intent;
    // key may or may not be written — design: only persist after successful connection+selection.
    await expect(fs.access(userConfigPath)).rejects.toBeTruthy();
  });

  it("surfaces endpoint_not_found for connection 404 without leaking secrets", async () => {
    const userConfigPath = await tempUserConfigPath();
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(404, { error: "missing" }));

    const outcome = await setupService({
      isTty: false,
      provider: "openrouter",
      apiKey,
      model: "openai/gpt-4o-mini",
      endpoint: "https://missing.example.com/v1",
      userConfigPath,
      fetchImpl
    });

    expect(outcome.exitCode).toBe(4);
    expect(outcome.result.reason).toBe("endpoint_not_found");
    expect(JSON.stringify(outcome.result)).not.toContain(apiKey);
  });

  it("falls back to manual model flag when discovery is unsupported", async () => {
    const userConfigPath = await tempUserConfigPath();
    // Connection test + listModels both get unusable listing bodies.
    const fetchImpl = fetchOk({ models: [] });

    const outcome = await setupService({
      isTty: false,
      provider: "ollama",
      apiKey,
      model: "manual-model-id",
      endpoint: "https://setup.test/v1",
      userConfigPath,
      fetchImpl
    });

    expect(outcome.exitCode).toBe(0);
    const details = outcome.result.details as {
      model: string;
      source?: string;
      warnings?: string[];
    };
    expect(details.model).toBe("manual-model-id");
    expect(details.source === "manual" || details.warnings?.some((w) => /manual|discovery/i.test(w))).toBe(
      true
    );
    const persisted = await readUserConfig(userConfigPath);
    expect(persisted.providers.ollama?.model).toBe("manual-model-id");
  });

  it("warns on non-vision model but still persists when --yes is set", async () => {
    const userConfigPath = await tempUserConfigPath();
    const fetchImpl = fetchOk({ data: [{ id: "glm-5.2" }, { id: "minimax-m3" }] });

    const outcome = await setupService({
      isTty: false,
      provider: "ollama",
      apiKey,
      model: "glm-5.2",
      yes: true,
      userConfigPath,
      fetchImpl
    });

    expect(outcome.exitCode).toBe(0);
    const details = outcome.result.details as {
      model: string;
      warnings?: string[];
      visionHint?: string;
    };
    expect(details.model).toBe("glm-5.2");
    expect(details.warnings?.some((w) => /glm-5\.2|image|vision/i.test(w))).toBe(true);
    const persisted = await readUserConfig(userConfigPath);
    expect(persisted.providers.ollama?.model).toBe("glm-5.2");
  });

  it("updates existing user config provider entry without wiping other providers", async () => {
    const userConfigPath = await tempUserConfigPath({
      activeProvider: "gemini",
      providers: {
        gemini: {
          provider: "gemini",
          apiKey: "gemini-keep-me-secret-key-value",
          model: "gemini-2.0-flash"
        },
        ollama: {
          provider: "ollama",
          apiKey: "old-ollama-key-value-xxxxxxxxxxxx",
          model: "old-model"
        }
      }
    });
    const fetchImpl = fetchOk({ data: [{ id: "minimax-m3" }] });

    const outcome = await setupService({
      isTty: false,
      provider: "ollama",
      apiKey,
      model: "minimax-m3",
      endpoint: "https://setup.test/v1",
      userConfigPath,
      fetchImpl
    });

    expect(outcome.exitCode).toBe(0);
    const persisted = await readUserConfig(userConfigPath);
    expect(persisted.activeProvider).toBe("ollama");
    expect(persisted.providers.ollama).toMatchObject({
      model: "minimax-m3",
      endpoint: "https://setup.test/v1",
      apiKey
    });
    expect(persisted.providers.gemini?.apiKey).toBe("gemini-keep-me-secret-key-value");
    expect(persisted.providers.gemini?.model).toBe("gemini-2.0-flash");
    expect(JSON.stringify(outcome.result)).not.toContain(apiKey);
    expect(JSON.stringify(outcome.result)).not.toContain("gemini-keep-me-secret-key-value");
  });
});

describe("setupService interactive (TTY) seams", () => {
  it("uses prompter for provider, masked key, and model when flags are absent", async () => {
    const userConfigPath = await tempUserConfigPath();
    const fetchImpl = fetchOk({ data: [{ id: "minimax-m3" }, { id: "glm-5.2" }] });
    const prompter = stubPrompter({
      select: vi
        .fn()
        .mockResolvedValueOnce("ollama")
        .mockResolvedValueOnce("minimax-m3"),
      password: vi.fn(async () => apiKey)
    });

    const outcome = await setupService({
      isTty: true,
      userConfigPath,
      fetchImpl,
      prompter
    });

    expect(outcome.exitCode).toBe(0);
    expect(prompter.password).toHaveBeenCalled();
    expect(prompter.select).toHaveBeenCalled();
    const persisted = await readUserConfig(userConfigPath);
    expect(persisted.providers.ollama?.apiKey).toBe(apiKey);
    expect(persisted.providers.ollama?.model).toBe("minimax-m3");
    expect(JSON.stringify(outcome.result)).not.toContain(apiKey);
  });

  it("prompts for manual model id when discovery is unavailable", async () => {
    const userConfigPath = await tempUserConfigPath();
    const fetchImpl = fetchOk({ models: [] });
    const prompter = stubPrompter({
      select: vi.fn(async () => "ollama"),
      password: vi.fn(async () => apiKey),
      input: vi.fn(async () => "typed-manual-model")
    });

    const outcome = await setupService({
      isTty: true,
      userConfigPath,
      fetchImpl,
      prompter
    });

    expect(outcome.exitCode).toBe(0);
    expect(prompter.input).toHaveBeenCalled();
    const persisted = await readUserConfig(userConfigPath);
    expect(persisted.providers.ollama?.model).toBe("typed-manual-model");
  });

  it("warns on non-vision selection and persists after confirm", async () => {
    const userConfigPath = await tempUserConfigPath();
    const fetchImpl = fetchOk({ data: [{ id: "glm-5.2" }, { id: "minimax-m3" }] });
    const prompter = stubPrompter({
      select: vi
        .fn()
        .mockResolvedValueOnce("ollama")
        .mockResolvedValueOnce("glm-5.2"),
      password: vi.fn(async () => apiKey),
      confirm: vi.fn(async () => true)
    });

    const outcome = await setupService({
      isTty: true,
      userConfigPath,
      fetchImpl,
      prompter
    });

    expect(outcome.exitCode).toBe(0);
    expect(prompter.confirm).toHaveBeenCalled();
    const details = outcome.result.details as { warnings?: string[]; model: string };
    expect(details.model).toBe("glm-5.2");
    expect(details.warnings?.length).toBeGreaterThan(0);
  });
});

describe("setupService → analyze provider resolution", () => {
  it("persists selection that resolveProviderConfig reuses for subsequent analyze wiring", async () => {
    const configHome = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-setup-resolve-"));
    roots.push(configHome);
    vi.stubEnv("APPDATA", configHome);
    vi.stubEnv("XDG_CONFIG_HOME", configHome);

    const userConfigPath = getUserConfigPath();
    await fs.mkdir(path.dirname(userConfigPath), { recursive: true });

    const fetchImpl = fetchOk({ data: [{ id: "minimax-m3" }, { id: "glm-5.2" }] });
    const setup = await setupService({
      isTty: false,
      provider: "ollama",
      apiKey,
      model: "minimax-m3",
      endpoint: "https://setup-reuse.test/v1",
      userConfigPath,
      fetchImpl
    });
    expect(setup.exitCode).toBe(0);

    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-setup-project-"));
    roots.push(projectRoot);

    const resolved = await resolveProviderConfig(projectRoot);
    expect(resolved).toMatchObject({
      id: "ollama",
      endpoint: "https://setup-reuse.test/v1",
      model: "minimax-m3",
      apiKey
    });
  });
});
