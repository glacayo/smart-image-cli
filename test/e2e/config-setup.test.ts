import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli/program.js";
import { rmWithRetry } from "../support/cleanup.js";

const roots: string[] = [];
const apiKey = ["sk", "e2e", "setupwizard123456789012345"].join("-");

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(roots.map((root) => rmWithRetry(root)));
  roots.length = 0;
  process.exitCode = undefined;
});

describe("config setup e2e (non-TTY)", () => {
  it("exits 3 without hanging when required flags are missing", async () => {
    const result = await runImg(["--json", "config", "setup", "--provider", "ollama"]);

    expect(result.exitCode).toBe(3);
    expect(result.json).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(result.stdout.trim().split(/\r?\n/).filter(Boolean)).toHaveLength(1);
    expect(result.stdout).not.toContain(apiKey);
    expect(result.stderr).not.toContain(apiKey);
  });

  it("completes non-interactive setup with flags and does not echo the api key", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "minimax-m3" }, { id: "glm-5.2" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runImg([
      "--json",
      "config",
      "setup",
      "--provider",
      "ollama",
      "--api-key",
      apiKey,
      "--model",
      "minimax-m3",
      "--endpoint",
      "https://e2e.setup.test/v1"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      ok: true,
      command: "config",
      details: {
        action: "setup",
        provider: "ollama",
        model: "minimax-m3",
        connectionTest: { ok: true }
      }
    });
    expect(result.stdout).not.toContain(apiKey);
    expect(result.stderr).not.toContain(apiKey);
    expect(JSON.stringify(result.json)).not.toContain(apiKey);

    const configPath = path.join(result.configHome, "smart-image-cli", "config.json");
    const raw = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      activeProvider: string;
      providers: { ollama: { apiKey: string; model: string } };
    };
    expect(raw.activeProvider).toBe("ollama");
    expect(raw.providers.ollama.apiKey).toBe(apiKey);
    expect(raw.providers.ollama.model).toBe("minimax-m3");
  });

  it("returns provider_auth exit 4 for invalid key without leaking it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: `bad ${apiKey}` } }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchImpl);

    const result = await runImg([
      "--json",
      "config",
      "setup",
      "--provider",
      "ollama",
      "--api-key",
      apiKey,
      "--model",
      "minimax-m3",
      "--endpoint",
      "https://e2e.setup.test/v1"
    ]);

    expect(result.exitCode).toBe(4);
    expect(result.json).toMatchObject({ ok: false, reason: "provider_auth" });
    expect(result.stdout).not.toContain(apiKey);
    expect(result.stderr).not.toContain(apiKey);
  });
});

async function runImg(args: string[]): Promise<{
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
  json: Record<string, unknown>;
  configHome: string;
}> {
  let stdout = "";
  let stderr = "";
  const originalExitCode = process.exitCode;
  const originalWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const envKeys = ["APPDATA", "XDG_CONFIG_HOME", "HOME"] as const;
  const originalEnv: Record<string, string | undefined> = {};
  for (const key of envKeys) {
    originalEnv[key] = process.env[key];
  }

  const configHome = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-setup-e2e-"));
  roots.push(configHome);

  process.exitCode = undefined;
  process.env.APPDATA = configHome;
  process.env.XDG_CONFIG_HOME = configHome;
  process.env.HOME = configHome;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stderr.write;

  try {
    await runCli(["node", "smart-img", ...args]);
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const json = lines.length > 0 ? (JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>) : {};
    return {
      exitCode: process.exitCode ?? 0,
      stdout,
      stderr,
      json,
      configHome
    };
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
}
