import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exiftool } from "exiftool-vendored";
import { runCli } from "../../src/cli/program.js";
import { rmWithRetry } from "../support/cleanup.js";

const roots: string[] = [];
const apiKey = ["sk", "e2e", "doctorreachability1234567890"].join("-");

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(roots.map((root) => rmWithRetry(root)));
  roots.length = 0;
  process.exitCode = undefined;
});

describe("doctor e2e provider reachability", () => {
  it("reports provider-endpoint and provider-model when discovery is stubbed healthy", async () => {
    vi.spyOn(exiftool, "version").mockResolvedValue("12.00");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: "minimax-m3" }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );

    const result = await runImg(["--json", "doctor"], {
      activeProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          endpoint: "https://e2e.doctor.test/v1",
          model: "minimax-m3",
          apiKey
        }
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.json.ok).toBe(true);
    const checks =
      (result.json.details as { checks?: Array<{ name: string; ok: boolean }> })?.checks ?? [];
    const names = checks.map((c) => c.name);
    expect(names).toContain("provider-endpoint");
    expect(names).toContain("provider-model");
    expect(checks.find((c) => c.name === "provider-endpoint")?.ok).toBe(true);
    expect(checks.find((c) => c.name === "provider-model")?.ok).toBe(true);
    expect(result.stdout).not.toContain(apiKey);
    expect(result.stderr).not.toContain(apiKey);
    expect(JSON.stringify(result.json)).not.toContain(apiKey);
  });

  it("fails with config setup guidance when configured model is absent", async () => {
    vi.spyOn(exiftool, "version").mockResolvedValue("12.00");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: "other-available" }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );

    const result = await runImg(["--json", "doctor"], {
      activeProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          endpoint: "https://e2e.doctor.test/v1",
          model: "missing-model",
          apiKey
        }
      }
    });

    expect(result.exitCode).toBe(5);
    expect(result.json.ok).toBe(false);
    const checks =
      (
        result.json.details as {
          checks?: Array<{ name: string; ok: boolean; message?: string }>;
        }
      )?.checks ?? [];
    const modelCheck = checks.find((c) => c.name === "provider-model");
    expect(modelCheck?.ok).toBe(false);
    expect(modelCheck?.message).toMatch(/config setup/i);
    expect(modelCheck?.message).toContain("missing-model");
    expect(JSON.stringify(result.json)).not.toContain(apiKey);
  });
});

async function runImg(
  args: string[],
  userConfig: unknown
): Promise<{
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
  json: Record<string, unknown>;
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

  const configHome = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-doctor-e2e-"));
  roots.push(configHome);
  await fs.mkdir(path.join(configHome, "smart-image-cli"), { recursive: true });
  await fs.writeFile(
    path.join(configHome, "smart-image-cli", "config.json"),
    `${JSON.stringify(userConfig, null, 2)}\n`
  );

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
    const json =
      lines.length > 0 ? (JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>) : {};
    return {
      exitCode: process.exitCode ?? 0,
      stdout,
      stderr,
      json
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
