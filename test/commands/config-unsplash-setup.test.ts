import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const configServiceMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ result: Record<string, unknown>; exitCode: number }> => ({
    result: {
      ok: true,
      status: "success",
      command: "config",
      details: {
        action: "unsplash-setup",
        scope: "user",
        unsplash: { accessKey: "[REDACTED]" }
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

describe("config command unsplash setup routing", () => {
  it("routes `config unsplash setup` to configService without any access-key option", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const program = new Command().exitOverride().option("--json");
    registerConfigCommand(program);

    await program.parseAsync(["node", "smart-img", "--json", "config", "unsplash", "setup"]);

    expect(process.exitCode).toBe(0);
    expect(configServiceMock).toHaveBeenCalledOnce();
    const call = configServiceMock.mock.calls[0] as unknown as [
      string,
      string | undefined,
      string | undefined,
      Record<string, unknown>
    ];
    expect(call[0]).toBe("unsplash");
    expect(call[1]).toBe("setup");
    // No access-key / unsplashAccessKey plumbing should reach the service.
    expect(call[3].unsplashAccessKey).toBeUndefined();
    expect(call[3].accessKey).toBeUndefined();
    const printed = String(stdout.mock.calls[0]?.[0] ?? "");
    expect(printed).toContain("[REDACTED]");
  });

  it("does not expose an --access-key option for the config command", async () => {
    const program = new Command().exitOverride().option("--json");
    registerConfigCommand(program);

    // Parsing `--access-key` must fail (unknown option) rather than be
    // accepted and routed, since the flag was removed.
    await expect(
      program.parseAsync([
        "node",
        "smart-img",
        "--json",
        "config",
        "unsplash",
        "setup",
        "--access-key",
        "anything"
      ])
    ).rejects.toThrow();
  });
});
