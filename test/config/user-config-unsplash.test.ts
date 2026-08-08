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
const legacyKey = "legacy-unsplash-access-key-ABCDEF0123456789";

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

describe("user-config legacy unsplash strip (WU6c1)", () => {
  it("normalized config has no unsplash field; empty defaults pixabay only", () => {
    const cfg = parseUserConfig({ activeProvider: "ollama", providers: {} });
    expect(cfg).not.toHaveProperty("unsplash");
    expect(cfg.pixabay).toEqual({});
    expect(emptyUserConfig()).toEqual({
      activeProvider: "ollama",
      providers: {},
      pixabay: {}
    });
    expect(getUserConfigPath().endsWith(path.join("smart-image-cli", "config.json"))).toBe(true);
  });

  it("strips legacy unsplash on parse without crash or key leakage into normalized output", () => {
    const key = "a-real-key-value-1234567890abcdef";
    const cfg = parseUserConfig({
      activeProvider: "ollama",
      providers: {},
      unsplash: { accessKey: key },
      pixabay: {}
    });
    expect(cfg).not.toHaveProperty("unsplash");
    expect(JSON.stringify(cfg)).not.toContain(key);
    expect(cfg.pixabay).toEqual({});
  });

  it("readUserConfig strips legacy block; write preserves on-disk unsplash and never migrates to pixabay", async () => {
    const configPath = await tempConfigPath({
      activeProvider: "ollama",
      providers: {
        ollama: { provider: "ollama", apiKey: "existing-ollama-key-1234567890", model: "minimax-m3" }
      },
      unsplash: { accessKey: legacyKey },
      pixabay: {}
    });

    const normalized = await readUserConfig(configPath);
    expect(normalized).not.toHaveProperty("unsplash");
    expect(JSON.stringify(normalized)).not.toContain(legacyKey);
    expect(normalized.providers.ollama?.apiKey).toBe("existing-ollama-key-1234567890");

    await writeUserConfig({ ...normalized, pixabay: { apiKey: "pixabay-api-key-1234567890abcdef" } }, configPath);

    const after = await readUserConfig(configPath);
    expect(after).not.toHaveProperty("unsplash");
    expect(after.pixabay.apiKey).toBe("pixabay-api-key-1234567890abcdef");
    expect(JSON.stringify(after)).not.toContain(legacyKey);

    const onDisk = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      unsplash?: { accessKey?: string };
      pixabay?: { apiKey?: string };
    };
    expect(onDisk.unsplash?.accessKey).toBe(legacyKey);
    expect(onDisk.pixabay?.apiKey).toBe("pixabay-api-key-1234567890abcdef");
  });

  it("writeUserConfig does not invent unsplash when none existed on disk", async () => {
    const configPath = await tempConfigPath();
    await writeUserConfig({ activeProvider: "ollama", providers: {}, pixabay: {} }, configPath);
    const raw = await fs.readFile(configPath, "utf8");
    expect(raw).not.toContain("unsplash");
    expect(await readUserConfig(configPath)).not.toHaveProperty("unsplash");
  });
});
