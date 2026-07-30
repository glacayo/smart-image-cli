import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const configServiceMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ result: Record<string, unknown>; exitCode: number }> => ({
    result: {
      ok: true,
      status: "success",
      command: "config",
      details: {
        action: "setup",
        provider: "ollama",
        model: "minimax-m3",
        connectionTest: { ok: true }
      }
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

describe("config command setup flags", () => {
  it("routes config setup with provider/api-key/model/endpoint/yes to configService", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const program = new Command().exitOverride().option("--json");
    registerConfigCommand(program);

    await program.parseAsync([
      "node",
      "img",
      "--json",
      "config",
      "setup",
      "--provider",
      "ollama",
      "--api-key",
      "sk-test-not-for-output",
      "--model",
      "minimax-m3",
      "--endpoint",
      "https://setup.example/v1",
      "--yes"
    ]);

    expect(process.exitCode).toBe(0);
    expect(configServiceMock).toHaveBeenCalledOnce();
    const call = configServiceMock.mock.calls[0] as unknown as [
      string,
      string | undefined,
      string | undefined,
      {
        provider?: string;
        apiKey?: string;
        model?: string;
        endpoint?: string;
        yes?: boolean;
      }
    ];
    expect(call[0]).toBe("setup");
    expect(call[3]).toMatchObject({
      provider: "ollama",
      apiKey: "sk-test-not-for-output",
      model: "minimax-m3",
      endpoint: "https://setup.example/v1",
      yes: true
    });
    const printed = String(stdout.mock.calls[0]?.[0] ?? "");
    expect(printed).not.toContain("sk-test-not-for-output");
    expect(printed).toContain("setup");
  });
});
