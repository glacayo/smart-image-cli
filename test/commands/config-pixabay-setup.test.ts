import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const configServiceMock = vi.hoisted(() =>
  vi.fn(async () => ({
    result: {
      ok: true,
      status: "success",
      command: "config",
      details: { action: "pixabay-setup", scope: "user", pixabay: { apiKey: "[REDACTED]" } }
    },
    exitCode: 0
  }))
);
vi.mock("../../src/app/config-service.js", () => ({ configService: configServiceMock }));
import { registerConfigCommand } from "../../src/commands/config.js";

afterEach(() => {
  vi.restoreAllMocks();
  configServiceMock.mockClear();
  process.exitCode = undefined;
});

describe("config pixabay setup routing", () => {
  it("routes setup without secret flags; rejects --pixabay-api-key", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const program = new Command().exitOverride().option("--json");
    registerConfigCommand(program);
    await program.parseAsync(["node", "smart-img", "--json", "config", "pixabay", "setup"]);
    expect(process.exitCode).toBe(0);
    const [action, key, , opts] = configServiceMock.mock.calls[0] as unknown as [
      string,
      string,
      unknown,
      Record<string, unknown>
    ];
    expect(action).toBe("pixabay");
    expect(key).toBe("setup");
    expect(opts.apiKey).toBeUndefined();
    expect(String(stdout.mock.calls[0]?.[0] ?? "")).toContain("[REDACTED]");
    const p2 = new Command().exitOverride().option("--json");
    registerConfigCommand(p2);
    await expect(
      p2.parseAsync(["node", "smart-img", "config", "pixabay", "setup", "--pixabay-api-key", "x"])
    ).rejects.toThrow();
  });
});
