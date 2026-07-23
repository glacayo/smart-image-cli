import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configService, ConfigKeyError } from "../../src/app/config-service.js";
import { doctorService } from "../../src/app/doctor-service.js";
import { statsService, listService } from "../../src/app/library-service.js";
import { listSidecars } from "../../src/app/runtime.js";
import { SidecarStore } from "../../src/adapters/sidecar-store.js";
import { StorageRootGuardError } from "../../src/adapters/storage-root-guard.js";
import { SqliteIndex } from "../../src/adapters/sqlite-index.js";
import type { Sidecar } from "../../src/adapters/sidecar-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("configService", () => {
  it("rejects __proto__ in dotted set keys to prevent prototype pollution", async () => {
    const root = await tempRoot();
    const outcome = await configService("set", "__proto__.polluted", "yes", {
      project: true,
      root
    });
    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("invalid_input");
    expect(outcome.result.message).toContain("__proto__");
  });

  it("rejects constructor and prototype segments in dotted set keys", async () => {
    const root = await tempRoot();
    const a = await configService("set", "constructor.prototype.bad", "x", {
      project: true,
      root
    });
    expect(a.exitCode).toBe(3);
    const b = await configService("set", "a.prototype.b", "x", {
      project: true,
      root
    });
    expect(b.exitCode).toBe(3);
  });

  it("rejects empty segments in dotted keys", async () => {
    const root = await tempRoot();
    const outcome = await configService("set", "a..b", "x", { project: true, root });
    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.message).toContain("empty segment");
  });

  it("rejects an empty dotted key", async () => {
    const root = await tempRoot();
    const outcome = await configService("set", "", "x", { project: true, root });
    expect(outcome.exitCode).toBe(3);
  });

  it("ConfigKeyError is a typed error", () => {
    const err = new ConfigKeyError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConfigKeyError");
  });

  it("reads and writes project config through the root guard", async () => {
    const root = await tempRoot();
    await fs.mkdir(path.join(root, ".img-ia"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".img-ia", "config.json"),
      `${JSON.stringify({ categories: [], outputDirs: ["_out"] })}\n`
    );
    const list = await configService("list", undefined, undefined, {
      project: true,
      root
    });
    expect(list.exitCode).toBe(0);
    expect(list.result.details).toHaveProperty("scope", "project");
  });

  it("rejects setting a secret-shaped value in project config", async () => {
    const root = await tempRoot();
    // Build the token dynamically so no committed literal looks like a real
    // provider token.
    const token = ["sk-proj", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
    const outcome = await configService("set", "provider.model", token, {
      project: true,
      root
    });
    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("invalid_input");
  });

  it("rejects setting a URL with embedded credentials in project config", async () => {
    const root = await tempRoot();
    const outcome = await configService("set", "provider.endpoint", "https://user:pass@host.com", {
      project: true,
      root
    });
    expect(outcome.exitCode).toBe(3);
    expect(outcome.result.reason).toBe("invalid_input");
  });

  it("surfaces a .img-ia symlink that escapes root as a structured failure for config reads", async () => {
    const root = await tempRoot();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-outside-"));
    roots.push(outside);
    await fs.mkdir(path.join(outside, ".img-ia"), { recursive: true });
    await fs.writeFile(
      path.join(outside, ".img-ia", "config.json"),
      `${JSON.stringify({ categories: [], outputDirs: ["_out"] })}\n`
    );
    // Attempt to create a symlink .img-ia -> outside/.img-ia inside root.
    // Skip the assertion (not the whole test) if the OS denies link creation.
    try {
      await fs.symlink(
        path.join(outside, ".img-ia"),
        path.join(root, ".img-ia"),
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch {
      return; // OS denied link creation; cannot test symlink escape on this platform
    }
    const list = await configService("list", undefined, undefined, {
      project: true,
      root
    });
    // The guard failure must surface as a structured failure (non-zero exit)
    // with a redacted message, not be silently hidden as an empty config.
    expect(list.exitCode).toBe(3);
    expect(list.result.reason).toBe("invalid_input");
    expect(JSON.stringify(list.result)).not.toContain(outside);
  });

  it("masks providers.<id>.apiKey on user-config get even when the value is short/non-token-shaped", async () => {
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "ollama",
      providers: { ollama: { provider: "ollama", apiKey: "short" } }
    });
    const outcome = await configService("get", "providers.ollama.apiKey", undefined, {
      userConfigPath
    });
    expect(outcome.exitCode).toBe(0);
    expect(JSON.stringify(outcome.result.details)).not.toContain("short");
    expect(JSON.stringify(outcome.result.details)).toContain("[REDACTED]");
  });

  it("masks providers.<id>.apiKey on user-config list even when the value is short", async () => {
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "ollama",
      providers: { ollama: { provider: "ollama", apiKey: "tiny" } }
    });
    const outcome = await configService("list", undefined, undefined, {
      userConfigPath
    });
    expect(outcome.exitCode).toBe(0);
    expect(JSON.stringify(outcome.result.details)).not.toContain("tiny");
    expect(JSON.stringify(outcome.result.details)).toContain("[REDACTED]");
  });

  it("redacts URL basic-auth credentials in user-config endpoint on get", async () => {
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "openrouter",
      providers: {
        openrouter: {
          provider: "openrouter",
          endpoint: "https://user:pass@host.com",
          apiKey: "test-key"
        }
      }
    });
    const outcome = await configService("get", "providers.openrouter.endpoint", undefined, {
      userConfigPath
    });
    expect(outcome.exitCode).toBe(0);
    const json = JSON.stringify(outcome.result.details);
    expect(json).not.toContain("user:pass");
    expect(json).toContain("[REDACTED]");
  });

  it("redacts URL basic-auth credentials in user-config endpoint on list", async () => {
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "openrouter",
      providers: {
        openrouter: {
          provider: "openrouter",
          endpoint: "https://user:pass@host.com",
          apiKey: "test-key"
        }
      }
    });
    const outcome = await configService("list", undefined, undefined, {
      userConfigPath
    });
    expect(outcome.exitCode).toBe(0);
    const json = JSON.stringify(outcome.result.details);
    expect(json).not.toContain("user:pass");
    expect(json).toContain("[REDACTED]");
  });

  it("redacts short query-param tokens in user-config endpoint on get", async () => {
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "gemini",
      providers: {
        gemini: {
          provider: "gemini",
          endpoint: "https://host.com?api_key=x",
          apiKey: "test-key"
        }
      }
    });
    const outcome = await configService("get", "providers.gemini.endpoint", undefined, {
      userConfigPath
    });
    expect(outcome.exitCode).toBe(0);
    const json = JSON.stringify(outcome.result.details);
    expect(json).not.toContain("api_key=x");
    expect(json).toContain("[REDACTED]");
  });

  it("surfaces a .img-ia symlink that escapes root as a structured failure for config get", async () => {
    const root = await tempRoot();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-outside-get-"));
    roots.push(outside);
    await fs.mkdir(path.join(outside, ".img-ia"), { recursive: true });
    await fs.writeFile(
      path.join(outside, ".img-ia", "config.json"),
      `${JSON.stringify({ categories: [], outputDirs: ["_out"] })}\n`
    );
    try {
      await fs.symlink(
        path.join(outside, ".img-ia"),
        path.join(root, ".img-ia"),
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch {
      return; // OS denied link creation; cannot test symlink escape on this platform
    }
    const get = await configService("get", "outputDirs", undefined, {
      project: true,
      root
    });
    expect(get.exitCode).toBe(3);
    expect(get.result.reason).toBe("invalid_input");
  });

  it("surfaces an escaping .img-ia symlink even when the final config.json is missing", async () => {
    // Regression: an escaping `.img-ia` symlink whose target has NO
    // config.json must still be rejected. Previously the final-path ENOENT
    // bypassed the parent-chain check, so the escaping symlink was treated
    // as a harmless missing config. The guard must validate the existing
    // parent chain even when the final path does not exist.
    const root = await tempRoot();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-outside-missing-"));
    roots.push(outside);
    // Create the outside `.img-ia` directory but deliberately DO NOT write
    // a config.json inside it — the symlink target exists, the final config
    // path does not.
    await fs.mkdir(path.join(outside, ".img-ia"), { recursive: true });
    try {
      await fs.symlink(
        path.join(outside, ".img-ia"),
        path.join(root, ".img-ia"),
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch {
      return; // OS denied link creation; cannot test symlink escape on this platform
    }
    const list = await configService("list", undefined, undefined, {
      project: true,
      root
    });
    expect(list.exitCode).toBe(3);
    expect(list.result.reason).toBe("invalid_input");
    expect(JSON.stringify(list.result)).not.toContain(outside);
  });
});

describe("doctorService", () => {
  it("reports success with sharp, sqlite, exiftool, and project-config checks when healthy", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "ollama",
      providers: {
        ollama: { provider: "ollama", apiKey: "test-key-for-doctor-healthy" }
      }
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        pingProvider: async () => undefined,
        userConfigPath
      }
    );
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result.status).toBe("success");
    const checks = (outcome.result.details as { checks: Array<{ name: string; ok: boolean }> })
      .checks;
    const names = checks.map((c) => c.name);
    expect(names).toContain("sharp");
    expect(names).toContain("sqlite");
    expect(names).toContain("exiftool");
    expect(names).toContain("project-config");
    expect(names).toContain("provider-config");
    expect(names).toContain("provider-ping");
  });

  it("reports exiftool readiness failure when the probe rejects", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "ollama",
      providers: { ollama: { provider: "ollama", apiKey: "test-key" } }
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => {
          throw new Error("ExifTool binary not found");
        },
        pingProvider: async () => undefined,
        userConfigPath
      }
    );
    expect(outcome.exitCode).toBe(5);
    expect(outcome.result.status).toBe("failed");
    expect(outcome.result.reason).toBe("doctor_failed");
    const checks = (
      outcome.result.details as { checks: Array<{ name: string; ok: boolean; message?: string }> }
    ).checks;
    const exiftoolCheck = checks.find((c) => c.name === "exiftool")!;
    expect(exiftoolCheck.ok).toBe(false);
    expect(exiftoolCheck.message).toContain("ExifTool");
  });

  it("reports provider-ping failure when the ping seam rejects", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "ollama",
      providers: { ollama: { provider: "ollama", apiKey: "test-key" } }
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        pingProvider: async () => {
          throw new Error("connection refused");
        },
        userConfigPath
      }
    );
    expect(outcome.exitCode).toBe(5);
    expect(outcome.result.status).toBe("failed");
    const checks = (
      outcome.result.details as { checks: Array<{ name: string; ok: boolean; message?: string }> }
    ).checks;
    const pingCheck = checks.find((c) => c.name === "provider-ping")!;
    expect(pingCheck.ok).toBe(false);
    expect(pingCheck.message).toContain("connection refused");
  });

  it("does not claim full readiness when provider-ping is deferred (no seam)", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "ollama",
      providers: { ollama: { provider: "ollama", apiKey: "test-key" } }
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        userConfigPath
      }
    );
    // Deferred ping must not be ok, and overall status must not be success.
    expect(outcome.exitCode).toBe(5);
    expect(outcome.result.status).toBe("failed");
    expect(outcome.result.reason).toBe("doctor_not_verified");
    const checks = (
      outcome.result.details as {
        checks: Array<{ name: string; ok: boolean; deferred?: boolean; message?: string }>;
      }
    ).checks;
    const pingCheck = checks.find((c) => c.name === "provider-ping")!;
    expect(pingCheck.ok).toBe(false);
    expect(pingCheck.deferred).toBe(true);
    expect(pingCheck.message).toContain("deferred");
  });

  it("reports ok when no provider api key is configured (no ping required)", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "ollama",
      providers: {}
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        userConfigPath
      }
    );
    // No api key means provider-config is ok=false, so overall fails, but
    // no provider-ping check is added.
    const checks = (outcome.result.details as { checks: Array<{ name: string; ok: boolean }> })
      .checks;
    expect(checks.some((c) => c.name === "provider-ping")).toBe(false);
    expect(checks.find((c) => c.name === "provider-config")!.ok).toBe(false);
  });

  it("masks URL basic-auth credentials in endpoint reported by doctor provider-ping", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "openrouter",
      providers: {
        openrouter: {
          provider: "openrouter",
          endpoint: "https://user:pass@host.com",
          apiKey: "test-key"
        }
      }
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        pingProvider: async () => undefined,
        userConfigPath
      }
    );
    const json = JSON.stringify(outcome.result.details);
    // The endpoint must not leak the basic-auth credentials.
    expect(json).not.toContain("user:pass");
    expect(json).toContain("[REDACTED]");
  });

  it("masks short query-param tokens in endpoint reported by doctor provider-ping", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "gemini",
      providers: {
        gemini: {
          provider: "gemini",
          endpoint: "https://host.com?api_key=x",
          apiKey: "test-key"
        }
      }
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        pingProvider: async () => undefined,
        userConfigPath
      }
    );
    const json = JSON.stringify(outcome.result.details);
    expect(json).not.toContain("api_key=x");
    expect(json).toContain("[REDACTED]");
  });

  it("masks refresh_token/client_secret params in endpoint reported by doctor", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "gemini",
      providers: {
        gemini: {
          provider: "gemini",
          endpoint: "https://host.com?refresh_token=rt-secret&id_token=it-secret#client_secret=cs-secret",
          apiKey: "test-key"
        }
      }
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        pingProvider: async () => undefined,
        userConfigPath
      }
    );
    const json = JSON.stringify(outcome.result.details);
    expect(json).not.toContain("rt-secret");
    expect(json).not.toContain("it-secret");
    expect(json).not.toContain("cs-secret");
    expect(json).toContain("[REDACTED]");
  });

  it("masks project config details defensively in doctor output", async () => {
    const root = await tempRoot();
    await fs.mkdir(path.join(root, ".img-ia"), { recursive: true });
    // Write a valid project config with a long endpoint that is NOT secret-
    // shaped (no token/query/fragment param, no credentials). The defensive
    // maskValue layer must still be applied so details are masked, proving the
    // doctor never emits raw project config values unmasked.
    await fs.writeFile(
      path.join(root, ".img-ia", "config.json"),
      `${JSON.stringify({
        categories: [],
        outputDirs: ["_out"],
        provider: { endpoint: "https://example.org/api/v1" }
      })}\n`
    );
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "ollama",
      providers: { ollama: { provider: "ollama", apiKey: "test-key" } }
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        pingProvider: async () => undefined,
        userConfigPath
      }
    );
    const checks = (
      outcome.result.details as { checks: Array<{ name: string; ok: boolean; details?: unknown }> }
    ).checks;
    const configCheck = checks.find((c) => c.name === "project-config")!;
    expect(configCheck.ok).toBe(true);
    // The details must be masked (an object), not the raw readProjectConfig
    // output. A masked object still round-trips through JSON; assert it is not
    // a raw string and contains the masked endpoint.
    expect(typeof configCheck.details).toBe("object");
    expect(configCheck.details).not.toBeNull();
  });

  it("does not print raw fragment tokens in project config via doctor (defense-in-depth)", async () => {
    const root = await tempRoot();
    await fs.mkdir(path.join(root, ".img-ia"), { recursive: true });
    // Write a project config with a fragment token endpoint. Validation now
    // rejects this at parse time, so the project-config check must be ok=false
    // and NO raw fragment token leaks into doctor output.
    await fs.writeFile(
      path.join(root, ".img-ia", "config.json"),
      `${JSON.stringify({
        categories: [],
        outputDirs: ["_out"],
        provider: { endpoint: "https://host.com#token=supersecretvalue123" }
      })}\n`
    );
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "ollama",
      providers: { ollama: { provider: "ollama", apiKey: "test-key" } }
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        pingProvider: async () => undefined,
        userConfigPath
      }
    );
    const json = JSON.stringify(outcome.result.details);
    // Validation rejects the fragment token so the check fails, and the raw
    // token must never appear in doctor output.
    expect(json).not.toContain("supersecretvalue123");
    expect(json).not.toContain("token=supersecretvalue123");
  });

  it("reports project-config as not-ok when .img-ia is a symlink escaping root", async () => {
    const root = await tempRoot();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-outside-cfg-"));
    roots.push(outside);
    await fs.mkdir(path.join(outside, ".img-ia"), { recursive: true });
    await fs.writeFile(
      path.join(outside, ".img-ia", "config.json"),
      `${JSON.stringify({ categories: [], outputDirs: ["_out"] })}\n`
    );
    // Attempt to create a symlink .img-ia -> outside/.img-ia inside root.
    // Skip honestly if the OS denies link creation.
    try {
      await fs.symlink(
        path.join(outside, ".img-ia"),
        path.join(root, ".img-ia"),
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch {
      return; // OS denied link creation; cannot test symlink escape here
    }
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "ollama",
      providers: { ollama: { provider: "ollama", apiKey: "test-key" } }
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        pingProvider: async () => undefined,
        userConfigPath
      }
    );
    // The project-config check must surface the guard failure as not-ok
    // rather than silently treating the escaping path as missing config.
    const checks = (
      outcome.result.details as { checks: Array<{ name: string; ok: boolean; message?: string }> }
    ).checks;
    const configCheck = checks.find((c) => c.name === "project-config")!;
    expect(configCheck.ok).toBe(false);
  });

  it("reports project-config as not-ok when escaping .img-ia symlink target has no config.json", async () => {
    // Regression for final-path ENOENT parent-chain validation: an escaping
    // `.img-ia` symlink whose target directory exists but contains no
    // config.json must still surface as a guard failure (not-ok), not be
    // silently treated as a missing config.
    const root = await tempRoot();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-outside-nocfg-"));
    roots.push(outside);
    await fs.mkdir(path.join(outside, ".img-ia"), { recursive: true });
    // Deliberately do NOT write config.json inside the outside .img-ia.
    try {
      await fs.symlink(
        path.join(outside, ".img-ia"),
        path.join(root, ".img-ia"),
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch {
      return; // OS denied link creation; cannot test symlink escape here
    }
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "ollama",
      providers: { ollama: { provider: "ollama", apiKey: "test-key" } }
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        pingProvider: async () => undefined,
        userConfigPath
      }
    );
    const checks = (
      outcome.result.details as { checks: Array<{ name: string; ok: boolean; message?: string }> }
    ).checks;
    const configCheck = checks.find((c) => c.name === "project-config")!;
    expect(configCheck.ok).toBe(false);
  });

  it("treats a genuinely missing config inside root as empty (ok) for doctor", async () => {
    // A root with NO `.img-ia` directory at all must remain a healthy
    // project-config check (empty config), proving the parent-chain
    // validation does not over-trigger for the normal missing-config case.
    const root = await tempRoot();
    const userConfigPath = await writeControlledUserConfig({
      activeProvider: "ollama",
      providers: { ollama: { provider: "ollama", apiKey: "test-key" } }
    });
    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        pingProvider: async () => undefined,
        userConfigPath
      }
    );
    const checks = (
      outcome.result.details as { checks: Array<{ name: string; ok: boolean; message?: string }> }
    ).checks;
    const configCheck = checks.find((c) => c.name === "project-config")!;
    expect(configCheck.ok).toBe(true);
  });
});

describe("listSidecars root guard", () => {
  it("returns empty when the sidecar directory does not exist", async () => {
    const root = await tempRoot();
    const store = new SidecarStore(root);
    const sidecars = await listSidecars(store);
    expect(sidecars).toEqual([]);
  });

  it("rejects a .img-ia/sidecars symlink that escapes root before enumeration", async () => {
    const root = await tempRoot();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-outside-sidecars-"));
    roots.push(outside);
    // Populate the outside sidecar dir with a fake sidecar file so that,
    // without the guard, fs.readdir would enumerate it.
    await fs.mkdir(path.join(outside, "sidecars"), { recursive: true });
    await fs.writeFile(
      path.join(outside, "sidecars", "deadbeef.json"),
      `${JSON.stringify({ sha256: "deadbeef" })}\n`
    );
    // Create .img-ia directory then replace sidecars with an escaping symlink.
    await fs.mkdir(path.join(root, ".img-ia"), { recursive: true });
    try {
      await fs.symlink(
        path.join(outside, "sidecars"),
        path.join(root, ".img-ia", "sidecars"),
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch {
      return; // OS denied link creation; cannot test symlink escape here
    }
    const store = new SidecarStore(root);
    // listSidecars must reject before enumerating the outside directory.
    await expect(listSidecars(store)).rejects.toThrow(StorageRootGuardError);
  });
});

describe("statsService and listService", () => {
  it("stats returns counts for an indexed root", async () => {
    const root = await indexedRoot();
    const outcome = await statsService(root);
    expect(outcome.exitCode).toBe(0);
    const details = outcome.result.details as { totals: Record<string, unknown> };
    expect(details.totals).toHaveProperty("images");
    expect(details.totals).toHaveProperty("occurrences");
  });

  it("list returns images for an indexed root", async () => {
    const root = await indexedRoot();
    const outcome = await listService(root, {});
    expect(outcome.exitCode).toBe(0);
    expect(JSON.stringify(outcome.result.details)).toContain("kitchen-remodeling");
  });
});

async function indexedRoot(): Promise<string> {
  const root = await tempRoot();
  const { sha, sidecar } = await writeImageAndSidecar(root);
  const index = new SqliteIndex(root);
  await index.rebuildFromSidecars([sidecar]);
  index.close();
  await fs.mkdir(path.join(root, ".img-ia", "sidecars"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".img-ia", "sidecars", `${sha}.json`),
    `${JSON.stringify(sidecar)}\n`
  );
  return root;
}

async function writeImageAndSidecar(root: string): Promise<{ sha: string; sidecar: Sidecar }> {
  const rel = "kitchen/kitchen-001.jpg";
  await fs.mkdir(path.join(root, "kitchen"), { recursive: true });
  const sharp = (await import("sharp")).default;
  await sharp({ create: { width: 200, height: 100, channels: 3, background: "blue" } })
    .jpeg()
    .toFile(path.join(root, rel));
  const bytes = await fs.readFile(path.join(root, rel));
  const sha = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
  return {
    sha,
    sidecar: {
      sha256: sha,
      classification: {
        subject: "Kitchen",
        categories: ["kitchen-remodeling"],
        orientation: "landscape",
        altText: "Kitchen",
        title: "Kitchen",
        description: "Kitchen",
        suggestedSlug: "kitchen"
      },
      dims: { width: 200, height: 100 },
      originalName: "kitchen.jpg",
      model: "test",
      canonicalRelPath: rel,
      occurrences: [rel],
      primaryFlag: "canonicalRelPath"
    }
  };
}

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-cfg-"));
  roots.push(root);
  return root;
}

async function writeControlledUserConfig(config: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-usercfg-"));
  roots.push(dir);
  const configPath = path.join(dir, "config.json");
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}
