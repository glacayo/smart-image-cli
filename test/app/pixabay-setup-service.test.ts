import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pixabaySetupService } from "../../src/app/pixabay-setup-service.js";
import { configService } from "../../src/app/config-service.js";
import { readUserConfig } from "../../src/app/runtime.js";
import type { Prompter } from "../../src/cli/prompter.js";

const roots: string[] = [];
const testKey = "pixabay-api-key-1234567890abcdef";
const setSecret = "pixabay-api-key-9876543210fedcba";

afterEach(async () => {
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
  roots.length = 0;
});

async function tempConfigPath(initial?: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-pixabay-setup-"));
  roots.push(dir);
  const p = path.join(dir, "config.json");
  if (initial !== undefined) await fs.writeFile(p, `${JSON.stringify(initial)}\n`);
  return p;
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

describe("pixabaySetupService + config guard", () => {
  it("rejects positional value on pixabay setup without prompt, persist, or echo", async () => {
    const positionalSecret = "pixabay-positional-secret-NEVER-LEAK-9f3c2a1b";
    const configPath = await tempConfigPath();
    const prompter = stubPrompter();
    const stderr: string[] = [];
    const outcome = await configService("pixabay", "setup", positionalSecret, {
      userConfigPath: configPath,
      isTty: true,
      prompter,
      stderr: { write: (s: string) => (stderr.push(s), true) } as unknown as NodeJS.WritableStream
    });
    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.ok).toBe(false);
    expect(outcome.result.reason).toBe("invalid_input");
    const blob = `${JSON.stringify(outcome.result)}${stderr.join("")}`;
    expect(blob).not.toContain(positionalSecret);
    expect(blob).toContain("missing_pixabay_credential");
    expect(blob).toContain("smart-img config pixabay setup");
    expect(prompter.password).not.toHaveBeenCalled();
    const persisted = await readUserConfig(configPath);
    expect(persisted.pixabay.apiKey).toBeUndefined();
  });

  it("non-TTY rejects; interactive persists+redacts; set blocked; list redacts", async () => {
    const prompter = stubPrompter();
    const nonTty = await pixabaySetupService({
      isTty: false,
      prompter,
      ...({ apiKey: testKey } as unknown as Record<string, unknown>)
    });
    expect(nonTty.exitCode).toBe(3);
    expect(JSON.stringify(nonTty.result)).not.toContain(testKey);
    expect(JSON.stringify(nonTty.result)).toContain("missing_pixabay_credential");
    expect(prompter.password).not.toHaveBeenCalled();

    const configPath = await tempConfigPath({
      activeProvider: "ollama",
      providers: {
        ollama: { provider: "ollama", apiKey: "existing-ollama-key-1234567890", model: "m" }
      }
    });
    const stderr: string[] = [];
    const ok = await pixabaySetupService({
      isTty: true,
      userConfigPath: configPath,
      prompter: stubPrompter({ password: vi.fn(async () => `  ${testKey}  `) }),
      stderr: { write: (s: string) => (stderr.push(s), true) } as unknown as NodeJS.WritableStream
    });
    expect(ok.exitCode).toBe(0);
    const persisted = await readUserConfig(configPath);
    expect(persisted.pixabay.apiKey).toBe(testKey);
    expect(persisted.providers.ollama?.apiKey).toBe("existing-ollama-key-1234567890");
    expect(JSON.stringify(ok.result)).not.toContain(testKey);
    expect(JSON.stringify(ok.result)).toContain("[REDACTED]");
    expect(JSON.stringify(ok.result)).toContain(
      "Pixabay API key saved securely in user-scoped config."
    );
    expect(JSON.stringify(ok.result)).not.toContain("pick --source pixabay");
    expect(stderr.join("")).not.toContain(testKey);
    expect(
      (
        await pixabaySetupService({
          isTty: true,
          userConfigPath: await tempConfigPath(),
          prompter: stubPrompter({ password: vi.fn(async () => "   ") })
        })
      ).exitCode
    ).toBe(3);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-pixabay-set-proj-"));
    roots.push(root);
    for (const [key, value] of [
      ["pixabay.apiKey", setSecret],
      ["pixabay", JSON.stringify({ apiKey: setSecret })]
    ] as const) {
      const o = await configService("set", key, value, { userConfigPath: configPath });
      expect(o.exitCode).toBe(3);
      expect(JSON.stringify(o.result)).not.toContain(setSecret);
      expect(JSON.stringify(o.result)).toContain("missing_pixabay_credential");
    }
    expect(
      (await configService("set", "pixabay.apiKey", setSecret, { project: true, root })).exitCode
    ).toBe(3);

    await fs.writeFile(
      configPath,
      JSON.stringify({
        activeProvider: "ollama",
        providers: { ollama: { provider: "ollama", apiKey: "k" } },
        pixabay: { apiKey: setSecret }
      })
    );
    const list = await configService("list", undefined, undefined, { userConfigPath: configPath });
    expect(JSON.stringify(list.result)).not.toContain(setSecret);
    expect(
      (await configService("set", "providers.ollama.model", "m3", { userConfigPath: configPath }))
        .exitCode
    ).toBe(0);
  });
});
