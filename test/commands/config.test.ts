import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const configServiceMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ result: Record<string, unknown>; exitCode: number }> => ({
    result: {
      ok: true,
      status: "success",
      command: "config",
      details: { action: "models", provider: "ollama", source: "discovery", models: [] }
    },
    exitCode: 0
  }))
);

vi.mock("../../src/app/config-service.js", () => ({
  configService: configServiceMock
}));

import { registerConfigCommand } from "../../src/commands/config.js";

afterEach(() => {
  vi.restoreAllMocks();
  configServiceMock.mockClear();
  process.exitCode = undefined;
});

describe("config command models and provider flags", () => {
  it("routes config models with --provider and --endpoint to configService", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const program = new Command().exitOverride().option("--json");
    registerConfigCommand(program);

    await program.parseAsync([
      "node",
      "img",
      "--json",
      "config",
      "models",
      "--provider",
      "gemini",
      "--endpoint",
      "https://example.test/v1"
    ]);

    expect(process.exitCode).toBe(0);
    expect(configServiceMock).toHaveBeenCalledOnce();
    const call = configServiceMock.mock.calls[0] as unknown as [
      string,
      string | undefined,
      string | undefined,
      { provider?: string; endpoint?: string }
    ];
    expect(call[0]).toBe("models");
    expect(call[1]).toBeUndefined();
    expect(call[2]).toBeUndefined();
    expect(call[3]).toMatchObject({
      provider: "gemini",
      endpoint: "https://example.test/v1"
    });
    const printed = String(stdout.mock.calls[0]?.[0] ?? "").trim();
    const parsed = JSON.parse(printed) as { ok: boolean; details: { action: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.details.action).toBe("models");
  });

  it("passes apiKey set through without echoing secrets on stdout", async () => {
    const secret = ["sk", "live", "commandtest123456789012345"].join("-");
    configServiceMock.mockResolvedValueOnce({
      result: {
        ok: true,
        status: "success",
        command: "config",
        details: {
          scope: "user",
          key: "providers.ollama.apiKey",
          value: "[REDACTED]",
          connectionTest: { ok: true }
        }
      },
      exitCode: 0
    });

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const program = new Command().exitOverride().option("--json");
    registerConfigCommand(program);

    await program.parseAsync([
      "node",
      "img",
      "--json",
      "config",
      "set",
      "providers.ollama.apiKey",
      secret
    ]);

    expect(process.exitCode).toBe(0);
    const call = configServiceMock.mock.calls[0] as unknown as [string, string, string];
    expect(call[0]).toBe("set");
    expect(call[1]).toBe("providers.ollama.apiKey");
    expect(call[2]).toBe(secret);
    const printed = String(stdout.mock.calls[0]?.[0] ?? "");
    expect(printed).not.toContain(secret);
    expect(printed).toContain("[REDACTED]");
  });
});
