import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configService } from "../../src/app/config-service.js";
import { readUserConfig } from "../../src/app/runtime.js";
import type { Prompter } from "../../src/cli/prompter.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];
const legacyKey = "legacy-unsplash-access-key-ABCDEF0123456789";
const setSecret = "unsplash-access-key-9876543210fedcba";
const pixabayKey = "pixabay-api-key-1234567890abcdef";

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function tempConfigPath(initial?: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-unsplash-removed-"));
  roots.push(dir);
  const configPath = path.join(dir, "config.json");
  if (initial !== undefined) {
    await fs.writeFile(configPath, `${JSON.stringify(initial, null, 2)}\n`);
  }
  return configPath;
}

async function tempProjectRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-unsplash-removed-proj-"));
  roots.push(root);
  return root;
}

function blobOf(outcome: { result: unknown }, extra = ""): string {
  return `${JSON.stringify(outcome.result)}${extra}`;
}

function noUnsplashGuidance(blob: string): void {
  const lower = blob.toLowerCase();
  expect(lower).not.toContain("unsplash.com/developers");
  expect(blob).not.toMatch(/config unsplash setup/i);
  expect(blob).not.toContain("missing_unsplash_credential");
  expect(lower).not.toMatch(/migration|private interactive|private terminal/);
}

describe("unsplash setup/config surface removed (WU6b2)", () => {
  it("deletes setup service + unit test and keeps tree free of imports/calls", () => {
    expect(nodeFs.existsSync(path.join(repoRoot, "src/app/unsplash-setup-service.ts"))).toBe(false);
    expect(nodeFs.existsSync(path.join(repoRoot, "test/app/unsplash-setup-service.test.ts"))).toBe(false);
    const re = /unsplash-setup-service(?:\.js)?|\bunsplashSetupService\b|\bUnsplashSetupServiceOptions\b/;
    const bad: string[] = [];
    const walk = (d: string): void => {
      for (const e of nodeFs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.name.endsWith(".ts")) {
          const rel = path.relative(repoRoot, f).split("\\").join("/");
          if (rel !== "test/app/unsplash-setup-removed.test.ts" && re.test(nodeFs.readFileSync(f, "utf8")))
            bad.push(rel);
        }
      }
    };
    walk(path.join(repoRoot, "src"));
    walk(path.join(repoRoot, "test"));
    expect(bad).toEqual([]);
  });

  it("setup unavailable with generic invalid_input; positional secret ignored; no guidance", async () => {
    const configPath = await tempConfigPath();
    const sentinel = "SAFE_SENTINEL_NEVER_LEAK_unsplash_setup";
    const prompter: Prompter = {
      select: vi.fn(async () => "ollama"),
      input: vi.fn(async () => "x"),
      password: vi.fn(async () => "should-not-be-called"),
      confirm: vi.fn(async () => true)
    };

    const outcome = await configService("unsplash", "setup", sentinel, {
      userConfigPath: configPath,
      isTty: true,
      prompter
    });

    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.ok).toBe(false);
    expect(outcome.result.reason).toBe("invalid_input");
    expect(outcome.result.command).toBe("config");
    const blob = blobOf(outcome);
    expect(blob).not.toContain(sentinel);
    expect(blob).not.toContain("should-not-be-called");
    noUnsplashGuidance(blob);
    expect(prompter.password).not.toHaveBeenCalled();

    const persisted = await readUserConfig(configPath);
    expect(persisted.unsplash.accessKey).toBeUndefined();
    expect(persisted.pixabay.apiKey).toBeUndefined();
  });

  it("blocks config set on unsplash.* (user + project) without write or secret echo", async () => {
    const configPath = await tempConfigPath({
      activeProvider: "ollama",
      providers: {},
      unsplash: {},
      pixabay: {}
    });
    const userSet = await configService("set", "unsplash.accessKey", setSecret, {
      userConfigPath: configPath
    });
    expect(userSet.exitCode).toBe(3);
    expect(userSet.result.reason).toBe("invalid_input");
    expect(blobOf(userSet)).not.toContain(setSecret);
    noUnsplashGuidance(blobOf(userSet));
    const afterUser = await readUserConfig(configPath);
    expect(afterUser.unsplash.accessKey).toBeUndefined();

    const whole = await configService("set", "unsplash", JSON.stringify({ accessKey: setSecret }), {
      userConfigPath: configPath
    });
    expect(whole.exitCode).toBe(3);
    expect(blobOf(whole)).not.toContain(setSecret);
    noUnsplashGuidance(blobOf(whole));
    expect((await readUserConfig(configPath)).unsplash.accessKey).toBeUndefined();

    const root = await tempProjectRoot();
    const projectSet = await configService("set", "unsplash.accessKey", setSecret, {
      project: true,
      root
    });
    expect(projectSet.exitCode).toBe(3);
    expect(blobOf(projectSet)).not.toContain(setSecret);
    noUnsplashGuidance(blobOf(projectSet));
    await expect(fs.access(path.join(root, ".img-ia", "config.json"))).rejects.toBeTruthy();
  });

  it("legacy unsplash.accessKey stays inert: preserved, not migrated, list redacts, setup dead", async () => {
    const configPath = await tempConfigPath({
      activeProvider: "ollama",
      providers: {},
      unsplash: { accessKey: legacyKey },
      pixabay: {}
    });

    const list = await configService("list", undefined, undefined, { userConfigPath: configPath });
    expect(list.exitCode).toBe(0);
    const listBlob = blobOf(list);
    // List must never echo the raw Access Key (shape redactor may truncate rather than [REDACTED]).
    expect(listBlob).not.toContain(legacyKey);

    const setup = await configService("unsplash", "setup", undefined, {
      userConfigPath: configPath,
      isTty: false
    });
    expect(setup.exitCode).toBe(3);
    expect(setup.result.ok).toBe(false);
    expect(setup.result.reason).toBe("invalid_input");
    noUnsplashGuidance(blobOf(setup));
    expect(blobOf(setup)).not.toContain(legacyKey);

    const onDisk = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      unsplash?: { accessKey?: string };
      pixabay?: { apiKey?: string };
    };
    expect(onDisk.unsplash?.accessKey).toBe(legacyKey);
    expect(onDisk.pixabay?.apiKey).toBeUndefined();
  });

  it("Pixabay private setup + set-block remain intact beside Unsplash removal", async () => {
    const configPath = await tempConfigPath({
      activeProvider: "ollama",
      providers: {},
      unsplash: { accessKey: legacyKey },
      pixabay: {}
    });
    const prompter: Prompter = {
      select: vi.fn(async () => "ollama"),
      input: vi.fn(async () => "x"),
      password: vi.fn(async () => pixabayKey),
      confirm: vi.fn(async () => true)
    };

    const ok = await configService("pixabay", "setup", undefined, {
      userConfigPath: configPath,
      isTty: true,
      prompter
    });
    expect(ok.exitCode).toBe(0);
    expect(prompter.password).toHaveBeenCalledOnce();
    expect(blobOf(ok)).not.toContain(pixabayKey);
    expect(blobOf(ok)).toContain("[REDACTED]");

    const persisted = await readUserConfig(configPath);
    expect(persisted.pixabay.apiKey).toBe(pixabayKey);
    expect(persisted.unsplash.accessKey).toBe(legacyKey);

    const blocked = await configService("set", "pixabay.apiKey", "other-pixabay-secret-zzzz", {
      userConfigPath: configPath
    });
    expect(blocked.exitCode).toBe(3);
    expect(blobOf(blocked)).toContain("missing_pixabay_credential");
    expect(blobOf(blocked)).toContain("smart-img config pixabay setup");
    expect((await readUserConfig(configPath)).pixabay.apiKey).toBe(pixabayKey);
  });
});
