import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  emptyUserConfig,
  parseUserConfig,
  getUserConfigPath
} from "../../src/config/user-config.js";
import { readUserConfig, writeUserConfig } from "../../src/app/runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function tempConfigPath(initial?: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-usercfg-"));
  roots.push(dir);
  const configPath = path.join(dir, "config.json");
  if (initial !== undefined) {
    await fs.writeFile(configPath, `${JSON.stringify(initial, null, 2)}\n`);
  }
  return configPath;
}

describe("user-config unsplash schema", () => {
  it("defaults unsplash to {} when absent", () => {
    const cfg = parseUserConfig({ activeProvider: "ollama", providers: {} });
    expect(cfg.unsplash).toEqual({});
  });

  it("parses an unsplash.accessKey entry", () => {
    const cfg = parseUserConfig({
      activeProvider: "ollama",
      providers: {},
      unsplash: { accessKey: "a-real-key-value-1234567890abcdef" }
    });
    expect(cfg.unsplash.accessKey).toBe("a-real-key-value-1234567890abcdef");
  });

  it("rejects unknown unsplash fields (strict)", () => {
    expect(() =>
      parseUserConfig({
        activeProvider: "ollama",
        providers: {},
        unsplash: { accessKey: "k", extra: 1 }
      })
    ).toThrow();
  });

  it("emptyUserConfig includes unsplash: {}", () => {
    expect(emptyUserConfig()).toEqual({
      activeProvider: "ollama",
      providers: {},
      unsplash: {}
    });
  });

  it("round-trips unsplash.accessKey through writeUserConfig/readUserConfig", async () => {
    const configPath = await tempConfigPath();
    await writeUserConfig(
      {
        activeProvider: "ollama",
        providers: {},
        unsplash: { accessKey: "persisted-key-1234567890abcdef" }
      },
      configPath
    );
    const persisted = await readUserConfig(configPath);
    expect(persisted.unsplash.accessKey).toBe("persisted-key-1234567890abcdef");

    // File must be written with mode 0600 on POSIX; on Windows the mode bit is
    // not meaningful, but the file must exist and be parseable JSON.
    const raw = await fs.readFile(configPath, "utf8");
    expect(raw).toContain("unsplash");
    expect(raw).toContain("persisted-key-1234567890abcdef");
  });

  it("preserves existing providers when unsplash is added", async () => {
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
    const current = await readUserConfig(configPath);
    await writeUserConfig(
      { ...current, unsplash: { accessKey: "new-unsplash-key-1234567890" } },
      configPath
    );
    const persisted = await readUserConfig(configPath);
    expect(persisted.providers.ollama?.apiKey).toBe("existing-ollama-key-1234567890");
    expect(persisted.providers.ollama?.model).toBe("minimax-m3");
    expect(persisted.unsplash.accessKey).toBe("new-unsplash-key-1234567890");
  });

  it("getUserConfigPath is stable and appends config.json", () => {
    const p = getUserConfigPath();
    expect(p.endsWith(path.join("smart-image-cli", "config.json"))).toBe(true);
  });
});
