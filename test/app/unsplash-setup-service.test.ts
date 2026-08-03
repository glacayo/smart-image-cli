import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { unsplashSetupService } from "../../src/app/unsplash-setup-service.js";
import { configService } from "../../src/app/config-service.js";
import { readUserConfig } from "../../src/app/runtime.js";
import type { Prompter } from "../../src/cli/prompter.js";

const roots: string[] = [];
const testKey = "unsplash-access-key-1234567890abcdef";

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function tempConfigPath(initial?: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-unsplash-setup-"));
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
    input: vi.fn(async () => "x"),
    password: vi.fn(async () => testKey),
    confirm: vi.fn(async () => true),
    ...overrides
  };
}

describe("unsplashSetupService (interactive/private only)", () => {
  it("non-TTY/JSON mode returns invalid_input with actionable guidance and no secret, never prompts", async () => {
    const prompter = stubPrompter();
    const outcome = await unsplashSetupService({ isTty: false, prompter });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("invalid_input");
    const blob = JSON.stringify(outcome.result);
    expect(blob).not.toContain(testKey);
    expect(blob).toContain("https://unsplash.com/developers");
    expect(blob).toContain("smart-img config unsplash setup");
    expect(blob).toContain("private interactive terminal");
    expect(prompter.password).not.toHaveBeenCalled();
  });

  it("interactive prompts via prompter.password (masked) and persists, never echoing the key", async () => {
    const configPath = await tempConfigPath();
    const prompter = stubPrompter({ password: vi.fn(async () => testKey) });

    const outcome = await unsplashSetupService({
      isTty: true,
      userConfigPath: configPath,
      prompter
    });

    expect(outcome.exitCode).toBe(0);
    expect(prompter.password).toHaveBeenCalledOnce();
    const persisted = await readUserConfig(configPath);
    expect(persisted.unsplash.accessKey).toBe(testKey);
    expect(JSON.stringify(outcome.result)).not.toContain(testKey);
    expect(JSON.stringify(outcome.result)).toContain("[REDACTED]");
  });

  it("rejects an empty key from the interactive prompt without persisting", async () => {
    const configPath = await tempConfigPath();
    const prompter = stubPrompter({ password: vi.fn(async () => "   ") });

    const outcome = await unsplashSetupService({
      isTty: true,
      userConfigPath: configPath,
      prompter
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("invalid_input");
    const persisted = await readUserConfig(configPath);
    expect(persisted.unsplash.accessKey).toBeUndefined();
  });

  it("preserves existing providers when unsplash key is added", async () => {
    const configPath = await tempConfigPath({
      activeProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          apiKey: "existing-ollama-key-1234567890",
          model: "minimax-m3"
        }
      }
    });
    const prompter = stubPrompter({ password: vi.fn(async () => testKey) });
    const outcome = await unsplashSetupService({
      isTty: true,
      userConfigPath: configPath,
      prompter
    });
    expect(outcome.exitCode).toBe(0);
    const persisted = await readUserConfig(configPath);
    expect(persisted.providers.ollama?.apiKey).toBe("existing-ollama-key-1234567890");
    expect(persisted.providers.ollama?.model).toBe("minimax-m3");
    expect(persisted.unsplash.accessKey).toBe(testKey);
  });

  it("writes a human-mode outcome line to stderr when provided, without the key", async () => {
    const configPath = await tempConfigPath();
    const stderr: string[] = [];
    const stream = {
      write: (s: string) => {
        stderr.push(s);
        return true;
      }
    };
    const prompter = stubPrompter({ password: vi.fn(async () => testKey) });

    const outcome = await unsplashSetupService({
      isTty: true,
      userConfigPath: configPath,
      prompter,
      stderr: stream as unknown as NodeJS.WritableStream
    });

    expect(outcome.exitCode).toBe(0);
    expect(stderr.join("")).toContain("smart-img config unsplash setup");
    expect(stderr.join("")).not.toContain(testKey);
  });

  it("does not accept an accessKey option (no escape hatch exists)", async () => {
    // The service type intentionally has no `accessKey` field; passing one via
    // an untyped cast must NOT bypass the interactive prompt — it is ignored
    // and the non-TTY path returns guidance instead.
    const prompter = stubPrompter();
    const outcome = await unsplashSetupService({
      isTty: false,
      prompter,
      ...({ accessKey: testKey } as unknown as Record<string, unknown>)
    });
    expect(outcome.exitCode).toBe(3);
    expect(prompter.password).not.toHaveBeenCalled();
    const blob = JSON.stringify(outcome.result);
    expect(blob).not.toContain(testKey);
  });
});

async function tempProjectRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-unsplash-set-proj-"));
  roots.push(root);
  return root;
}

const setSecret = "unsplash-access-key-9876543210fedcba";
const setSecretBlob = JSON.stringify({ accessKey: setSecret });

describe("configService blocks generic `config set` on the unsplash subtree", () => {
  it("rejects `config set unsplash.accessKey <secret>` (user scope) without persisting or echoing", async () => {
    const configPath = await tempConfigPath();
    const outcome = await configService("set", "unsplash.accessKey", setSecret, {
      userConfigPath: configPath
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("invalid_input");
    expect(outcome.result.command).toBe("config");
    const blob = JSON.stringify(outcome.result);
    expect(blob).not.toContain(setSecret);
    expect(blob).toContain("smart-img config unsplash setup");

    const persisted = await readUserConfig(configPath);
    expect(persisted.unsplash.accessKey).toBeUndefined();
  });

  it("rejects `config set unsplash <json>` (whole subtree, user scope) without persisting or echoing", async () => {
    const configPath = await tempConfigPath();
    const outcome = await configService("set", "unsplash", setSecretBlob, {
      userConfigPath: configPath
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("invalid_input");
    const blob = JSON.stringify(outcome.result);
    expect(blob).not.toContain(setSecret);
    expect(blob).toContain("smart-img config unsplash setup");

    const persisted = await readUserConfig(configPath);
    expect(persisted.unsplash.accessKey).toBeUndefined();
  });

  it("rejects `config set --project unsplash.accessKey <secret>` without persisting", async () => {
    const root = await tempProjectRoot();
    const outcome = await configService("set", "unsplash.accessKey", setSecret, {
      project: true,
      root
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("invalid_input");
    const blob = JSON.stringify(outcome.result);
    expect(blob).not.toContain(setSecret);
    expect(blob).toContain("smart-img config unsplash setup");

    const projectConfig = path.join(root, ".img-ia", "config.json");
    await expect(fs.access(projectConfig)).rejects.toBeTruthy();
  });

  it("preserves other config set behavior (providers.ollama.model still works)", async () => {
    const configPath = await tempConfigPath({
      activeProvider: "ollama",
      providers: { ollama: { provider: "ollama", apiKey: "k" } },
      unsplash: {}
    });
    const outcome = await configService("set", "providers.ollama.model", "minimax-m3", {
      userConfigPath: configPath
    });
    expect(outcome.exitCode).toBe(0);
    const persisted = await readUserConfig(configPath);
    expect(persisted.providers.ollama?.model).toBe("minimax-m3");
  });
});
