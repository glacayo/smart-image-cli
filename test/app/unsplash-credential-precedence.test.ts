import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveUnsplashCredential,
  MissingUnsplashCredentialError,
  readUserConfig,
  writeUserConfig
} from "../../src/app/runtime.js";

const roots: string[] = [];
const envKey = "env-override-unsplash-key-1234567890";
const configKey = "user-config-unsplash-key-1234567890";

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function tempConfigPath(initial?: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-unsplash-cred-"));
  roots.push(dir);
  const configPath = path.join(dir, "config.json");
  if (initial !== undefined) {
    await fs.writeFile(configPath, `${JSON.stringify(initial, null, 2)}\n`);
  }
  return configPath;
}

describe("resolveUnsplashCredential precedence", () => {
  it("prefers UNSPLASH_ACCESS_KEY env override over user config", async () => {
    const configPath = await tempConfigPath({
      activeProvider: "ollama",
      providers: {},
      unsplash: { accessKey: configKey }
    });
    vi.stubEnv("UNSPLASH_ACCESS_KEY", envKey);

    const cred = await resolveUnsplashCredential(configPath, process.env);

    expect(cred.accessKey).toBe(envKey);
    expect(cred.source).toBe("env");
  });

  it("falls back to user config when env is absent", async () => {
    const configPath = await tempConfigPath({
      activeProvider: "ollama",
      providers: {},
      unsplash: { accessKey: configKey }
    });
    vi.stubEnv("UNSPLASH_ACCESS_KEY", "");

    const cred = await resolveUnsplashCredential(configPath, process.env);

    expect(cred.accessKey).toBe(configKey);
    expect(cred.source).toBe("user-config");
  });

  it("throws MissingUnsplashCredentialError when neither env nor config has a key", async () => {
    const configPath = await tempConfigPath();
    vi.stubEnv("UNSPLASH_ACCESS_KEY", "");

    await expect(resolveUnsplashCredential(configPath, process.env)).rejects.toBeInstanceOf(
      MissingUnsplashCredentialError
    );
  });

  it("ignores whitespace-only env value", async () => {
    const configPath = await tempConfigPath({
      activeProvider: "ollama",
      providers: {},
      unsplash: { accessKey: configKey }
    });
    vi.stubEnv("UNSPLASH_ACCESS_KEY", "   ");

    const cred = await resolveUnsplashCredential(configPath, process.env);
    expect(cred.accessKey).toBe(configKey);
    expect(cred.source).toBe("user-config");
  });

  it("MissingUnsplashCredentialError guidance is secret-free and actionable", () => {
    const error = new MissingUnsplashCredentialError();
    const guidance = error.guidance;
    expect(guidance.reason).toBe("missing_unsplash_credential");
    expect(guidance.obtain).toContain("https://unsplash.com/developers");
    expect(guidance.setupCommand).toContain("smart-img config unsplash setup");
    expect(guidance.retry).toContain("smart-img pick --source unsplash");
    const blob = JSON.stringify(guidance);
    expect(blob).not.toContain(envKey);
    expect(blob).not.toContain(configKey);
  });

  it("reads a freshly written user config after setup", async () => {
    const configPath = await tempConfigPath();
    vi.stubEnv("UNSPLASH_ACCESS_KEY", "");

    await writeUserConfig(
      { activeProvider: "ollama", providers: {}, unsplash: { accessKey: configKey } },
      configPath
    );

    const cred = await resolveUnsplashCredential(configPath, process.env);
    expect(cred.accessKey).toBe(configKey);
    expect(cred.source).toBe("user-config");
    const persisted = await readUserConfig(configPath);
    expect(persisted.unsplash.accessKey).toBe(configKey);
  });
});
