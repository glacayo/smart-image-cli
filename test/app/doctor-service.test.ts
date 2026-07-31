import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { doctorService } from "../../src/app/doctor-service.js";

const roots: string[] = [];
const secretKey = ["sk", "doctor", "redact-me-never-print-xyz"].join("-");

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe("doctorService provider reachability (PR5)", () => {
  it("reports active provider, endpoint, and model with reachability when discovery succeeds", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeUserConfig({
      activeProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          endpoint: "https://doctor.example/v1",
          model: "minimax-m3",
          apiKey: secretKey
        }
      }
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/chat") && init?.method === "POST") {
        return jsonResponse({ choices: [{ message: { content: "OK" } }] });
      }
      return jsonResponse({
        data: [{ id: "minimax-m3" }, { id: "glm-5.2" }]
      });
    });

    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        fetchImpl,
        userConfigPath
      }
    );

    expect(outcome.exitCode).toBe(0);
    expect(outcome.result.status).toBe("success");

    const checks = getChecks(outcome);
    const names = checks.map((c) => c.name);
    expect(names).toContain("provider-config");
    expect(names).toContain("provider-endpoint");
    expect(names).toContain("provider-model");
    expect(names).toContain("provider-chat");
    expect(names).not.toContain("provider-ping");

    const configCheck = checks.find((c) => c.name === "provider-config")!;
    expect(configCheck.ok).toBe(true);
    const details = configCheck.details as {
      activeProvider?: string;
      provider?: { model?: string; endpoint?: string; apiKey?: string };
    };
    expect(details.activeProvider).toBe("ollama");
    expect(details.provider?.model).toBe("minimax-m3");
    expect(JSON.stringify(details)).not.toContain(secretKey);
    expect(JSON.stringify(details)).toContain("[REDACTED]");

    expect(checks.find((c) => c.name === "provider-endpoint")!.ok).toBe(true);
    expect(checks.find((c) => c.name === "provider-model")!.ok).toBe(true);
    expect(checks.find((c) => c.name === "provider-chat")!.ok).toBe(true);
    expect(checks.find((c) => c.name === "provider-chat")!.details).toMatchObject({
      route: "POST /api/chat"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails provider-chat when model discovery succeeds but chat completions auth fails", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeUserConfig({
      activeProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          endpoint: "https://doctor.example/v1",
          model: "minimax-m3",
          apiKey: secretKey
        }
      }
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/chat") && init?.method === "POST") {
        return jsonResponse({ error: { message: `invalid key ${secretKey}` } }, 401);
      }
      return jsonResponse({ data: [{ id: "minimax-m3" }] });
    });

    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        fetchImpl,
        userConfigPath
      }
    );

    expect(outcome.exitCode).toBe(5);
    expect(outcome.result.status).toBe("failed");

    const checks = getChecks(outcome);
    expect(checks.find((c) => c.name === "provider-endpoint")?.ok).toBe(true);
    expect(checks.find((c) => c.name === "provider-model")?.ok).toBe(true);

    const chatCheck = checks.find((c) => c.name === "provider-chat")!;
    expect(chatCheck.ok).toBe(false);
    expect(chatCheck.details).toMatchObject({ route: "POST /api/chat" });
    expect(chatCheck.message).toMatch(/ollama chat|chat/i);
    expect(chatCheck.message).toMatch(/inference|list models/i);

    const json = JSON.stringify(outcome.result);
    expect(json).not.toContain(secretKey);
    expect(json).toContain("[REDACTED]");
  });

  it("fails provider-model with actionable config setup guidance when model is missing from listing", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeUserConfig({
      activeProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          endpoint: "https://doctor.example/v1",
          model: "gone-model",
          apiKey: secretKey
        }
      }
    });

    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ id: "minimax-m3" }, { id: "other-model" }]
      })
    );

    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        fetchImpl,
        userConfigPath
      }
    );

    expect(outcome.exitCode).toBe(5);
    expect(outcome.result.status).toBe("failed");
    expect(outcome.result.reason).toBe("doctor_failed");

    const modelCheck = getChecks(outcome).find((c) => c.name === "provider-model")!;
    expect(modelCheck.ok).toBe(false);
    expect(modelCheck.message).toContain("gone-model");
    expect(modelCheck.message).toMatch(/config setup/i);

    const endpointCheck = getChecks(outcome).find((c) => c.name === "provider-endpoint")!;
    expect(endpointCheck.ok).toBe(true);

    const json = JSON.stringify(outcome.result);
    expect(json).not.toContain(secretKey);
  });

  it("fails provider-endpoint on auth errors without leaking the API key", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeUserConfig({
      activeProvider: "openrouter",
      providers: {
        openrouter: {
          provider: "openrouter",
          endpoint: "https://openrouter.example/api/v1",
          model: "openai/gpt-4o-mini",
          apiKey: secretKey
        }
      }
    });

    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: `invalid key ${secretKey}` } }, 401)
    );

    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        fetchImpl,
        userConfigPath
      }
    );

    expect(outcome.exitCode).toBe(5);
    const checks = getChecks(outcome);
    const endpointCheck = checks.find((c) => c.name === "provider-endpoint")!;
    expect(endpointCheck.ok).toBe(false);
    expect(endpointCheck.message?.toLowerCase()).toMatch(/auth|authentication|unauthorized|failed/);

    // Model check should not claim success when endpoint auth failed.
    const modelCheck = checks.find((c) => c.name === "provider-model");
    expect(modelCheck?.ok).not.toBe(true);

    const json = JSON.stringify(outcome.result);
    expect(json).not.toContain(secretKey);
    expect(json).toContain("[REDACTED]");
  });

  it("masks endpoint credentials in provider-endpoint and provider-model details", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeUserConfig({
      activeProvider: "gemini",
      providers: {
        gemini: {
          provider: "gemini",
          endpoint: "https://user:pass@host.example/v1?api_key=x",
          model: "gemini-2.0-flash",
          apiKey: secretKey
        }
      }
    });

    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ id: "models/gemini-2.0-flash" }]
      })
    );

    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        fetchImpl,
        userConfigPath
      }
    );

    const json = JSON.stringify(outcome.result.details);
    expect(json).not.toContain("user:pass");
    expect(json).not.toContain("api_key=x");
    expect(json).not.toContain(secretKey);
    expect(json).toContain("[REDACTED]");
  });

  it("skips endpoint/model reachability checks when no API key is configured", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeUserConfig({
      activeProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          model: "minimax-m3"
        }
      }
    });

    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }));

    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        fetchImpl,
        userConfigPath
      }
    );

    const checks = getChecks(outcome);
    expect(checks.some((c) => c.name === "provider-endpoint")).toBe(false);
    expect(checks.some((c) => c.name === "provider-model")).toBe(false);
    expect(checks.find((c) => c.name === "provider-config")!.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails provider-model when discovery cannot list models, pointing to config setup", async () => {
    const root = await tempRoot();
    const userConfigPath = await writeUserConfig({
      activeProvider: "ollama",
      providers: {
        ollama: {
          provider: "ollama",
          endpoint: "https://doctor.example/v1",
          model: "minimax-m3",
          apiKey: secretKey
        }
      }
    });

    // Connection succeeds (200) but body is non-JSON → discovery unsupported.
    const fetchImpl = vi.fn(async () => new Response("not-json", { status: 200 }));

    const outcome = await doctorService(
      { root },
      {
        exiftoolProbe: async () => undefined,
        fetchImpl,
        userConfigPath
      }
    );

    expect(outcome.exitCode).toBe(5);
    const endpointCheck = getChecks(outcome).find((c) => c.name === "provider-endpoint")!;
    expect(endpointCheck.ok).toBe(true);
    const modelCheck = getChecks(outcome).find((c) => c.name === "provider-model")!;
    expect(modelCheck.ok).toBe(false);
    expect(modelCheck.message).toMatch(/config setup/i);
  });
});

function getChecks(outcome: {
  result: { details?: unknown };
}): Array<{ name: string; ok: boolean; message?: string; details?: unknown }> {
  return (
    (
      outcome.result.details as {
        checks?: Array<{ name: string; ok: boolean; message?: string; details?: unknown }>;
      }
    )?.checks ?? []
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-doctor-"));
  roots.push(root);
  return root;
}

async function writeUserConfig(config: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-image-doctor-usercfg-"));
  roots.push(dir);
  const configPath = path.join(dir, "config.json");
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}
