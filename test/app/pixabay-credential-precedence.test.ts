import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolvePixabayApiKey,
  MissingPixabayCredentialError,
  readUserConfig,
  writeUserConfig
} from "../../src/app/runtime.js";
import { doctorService } from "../../src/app/doctor-service.js";

const roots: string[] = [];
const envKey = "env-override-pixabay-key-1234567890";
const configKey = "user-config-pixabay-key-1234567890";

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
  roots.length = 0;
});

async function tempConfigPath(initial?: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-pixabay-cred-"));
  roots.push(dir);
  const p = path.join(dir, "config.json");
  if (initial !== undefined) await fs.writeFile(p, `${JSON.stringify(initial)}\n`);
  return p;
}

describe("resolvePixabayApiKey + doctor redaction", () => {
  it("env > config > missing; doctor stays key-free", async () => {
    const configPath = await tempConfigPath({
      activeProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          apiKey: "ollama-doctor-key-1234567890abcdef",
          model: "llava",
          endpoint: "http://127.0.0.1:11434"
        }
      },
      pixabay: { apiKey: configKey }
    });
    vi.stubEnv("PIXABAY_API_KEY", envKey);
    expect(await resolvePixabayApiKey(configPath, process.env)).toEqual({
      apiKey: envKey,
      source: "env"
    });
    vi.stubEnv("PIXABAY_API_KEY", "   ");
    expect(await resolvePixabayApiKey(configPath, process.env)).toEqual({
      apiKey: configKey,
      source: "user-config"
    });
    vi.stubEnv("PIXABAY_API_KEY", "");
    await expect(resolvePixabayApiKey(await tempConfigPath(), process.env)).rejects.toBeInstanceOf(
      MissingPixabayCredentialError
    );
    expect(new MissingPixabayCredentialError().guidance.reason).toBe("missing_pixabay_credential");

    const fresh = await tempConfigPath();
    await writeUserConfig({ activeProvider: "ollama", providers: {}, pixabay: { apiKey: configKey } }, fresh);
    expect((await readUserConfig(fresh)).pixabay.apiKey).toBe(configKey);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-pixabay-doctor-"));
    roots.push(root);
    const doctor = await doctorService(
      { root },
      {
        userConfigPath: configPath,
        exiftoolProbe: async () => undefined,
        fetchImpl: async () => new Response("{}", { status: 200 })
      }
    );
    expect(JSON.stringify(doctor.result)).not.toMatch(new RegExp(`${configKey}|${envKey}`));
  });
});
