import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/cli/program.js";
import { rmWithRetry } from "../support/cleanup.js";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(roots.map((root) => rmWithRetry(root)));
  roots.length = 0;
  process.exitCode = undefined;
});

describe("pick --source rejection e2e (WU6c2)", () => {
  it("rejects --source unsplash with exit 3 before any network/source logic", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network must not be called for rejected source");
    });
    vi.stubGlobal("fetch", fetchImpl);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-pick-src-rej-"));
    roots.push(root);

    const result = await runImg([
      "--json",
      "pick",
      root,
      "--source",
      "unsplash",
      "--query",
      "SAFE_SENTINEL_never_network"
    ]);

    expect(result.exitCode).toBe(3);
    expect(result.json).toMatchObject({
      ok: false,
      status: "failed",
      command: "pick",
      reason: "invalid_input"
    });
    expect(String(result.json.message)).toMatch(/--source must be one of:\s*local,\s*pixabay/);
    expect(String(result.json.message)).toContain('got: "unsplash"');
    expect(String(result.json.message)).not.toMatch(
      /config unsplash setup|unsplash\.com\/developers|migration|missing_unsplash|requires --query/i
    );
    expect(result.stdout).not.toContain("SAFE_SENTINEL");
    expect(result.stderr).not.toContain("SAFE_SENTINEL");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still accepts --source local and --source pixabay at the CLI surface", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network must not be called for this enum surface check");
    });
    vi.stubGlobal("fetch", fetchImpl);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-pick-src-ok-"));
    roots.push(root);

    // local without index → no_match/filesystem path, but NOT invalid_input for source enum
    const local = await runImg(["--json", "pick", root, "--category", "kitchen"]);
    expect(local.exitCode).not.toBe(3);
    expect(local.json.reason).not.toBe("invalid_input");
    expect(fetchImpl).not.toHaveBeenCalled();

    // pixabay missing credential fails closed after enum accept — still no network if resolver fails first
    const pixabay = await runImg([
      "--json",
      "pick",
      root,
      "--source",
      "pixabay",
      "--query",
      "kitchen"
    ]);
    expect(pixabay.exitCode).not.toBe(3);
    expect(pixabay.json).toMatchObject({ ok: false, command: "pick" });
    expect(pixabay.json.reason).not.toBe("invalid_input");
    expect(String(pixabay.json.reason)).toMatch(/missing_pixabay_credential|provider_error/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

async function runImg(args: string[]): Promise<{
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

  const configHome = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-pick-src-env-"));
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
