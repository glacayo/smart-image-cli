import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerConfigCommand } from "../../src/commands/config.js";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function helpText(): string {
  const program = new Command().exitOverride().option("--json");
  registerConfigCommand(program);
  const cfg = program.commands.find((c) => c.name() === "config");
  return cfg?.helpInformation() ?? "";
}

describe("config command unsplash setup removed", () => {
  it("unsplash setup exits 3 with generic invalid_input; no guidance; no access-key flag", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const program = new Command().exitOverride().option("--json");
    registerConfigCommand(program);

    const sentinel = "SAFE_SENTINEL_NEVER_LEAK_unsplash_setup";
    await program.parseAsync([
      "node",
      "smart-img",
      "--json",
      "config",
      "unsplash",
      "setup",
      sentinel
    ]);

    expect(process.exitCode).toBe(3);
    const printed = `${stdout.mock.calls.map((c) => c[0]).join("")}${stderr.mock.calls.map((c) => c[0]).join("")}`;
    expect(printed).not.toContain(sentinel);
    expect(printed.toLowerCase()).not.toContain("unsplash.com/developers");
    expect(printed).not.toMatch(/config unsplash setup/i);
    expect(printed).not.toContain("missing_unsplash_credential");
    expect(printed).toContain("invalid_input");

    const p2 = new Command().exitOverride().option("--json");
    registerConfigCommand(p2);
    await expect(
      p2.parseAsync([
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

  it("help drops unsplash setup and retains generic + pixabay setup", () => {
    const help = helpText().replace(/\s+/g, " ");
    expect(help).toMatch(/pixabay setup/i);
    expect(help).toMatch(/\bsetup\b/);
    expect(help).not.toMatch(/unsplash setup/i);
    expect(help).not.toMatch(/access-key/i);
  });
});
