import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const pickServiceMock = vi.hoisted(() =>
  vi.fn(async () => ({
    result: { ok: true, status: "success", command: "pick" },
    exitCode: 0
  }))
);
const buildTextRankerProviderMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/app/pick-service.js", () => ({
  pickService: pickServiceMock
}));

vi.mock("../../src/app/runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/runtime.js")>();
  return { ...actual, buildTextRankerProvider: buildTextRankerProviderMock };
});

import {
  buildPickDeps,
  parsePickOptions,
  registerPickCommand,
  validatePickEnumOption,
  validatePickTopKOption
} from "../../src/commands/pick.js";
import { LocalTextRanker } from "../../src/adapters/vision/local-text-ranker.js";

afterEach(() => {
  vi.restoreAllMocks();
  pickServiceMock.mockClear();
  buildTextRankerProviderMock.mockReset();
  process.exitCode = undefined;
});

describe("pick semantic CLI options", () => {
  it("defaults --query without --semantic to local ranker wiring and emits a stderr note", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const program = new Command().exitOverride().option("--json");
    registerPickCommand(program);

    await program.parseAsync([
      "node",
      "smart-img",
      "--json",
      "pick",
      "/tmp/project",
      "--query",
      "bright shower"
    ]);

    expect(process.exitCode).toBe(0);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("defaulted to --semantic local"));
    expect(stdout).toHaveBeenCalled();
    expect(pickServiceMock).toHaveBeenCalledOnce();
    const [, options, deps] = pickServiceMock.mock.calls[0]!;
    expect(options).toMatchObject({ query: "bright shower" });
    expect(deps.textRanker).toBeInstanceOf(LocalTextRanker);
  });

  it("parses explicit semantic ai and top-k values", () => {
    expect(
      parsePickOptions({ query: "bright shower", semantic: "ai", topK: "5", category: "bathroom" })
    ).toMatchObject({
      query: "bright shower",
      semantic: "ai",
      topK: 5,
      category: "bathroom"
    });
  });

  it("validates semantic mode input", () => {
    expect(validatePickEnumOption("semantic", "local")).toBeUndefined();
    expect(validatePickEnumOption("semantic", "ai")).toBeUndefined();
    const err = validatePickEnumOption("semantic", "remote");
    expect(err?.reason).toBe("invalid_input");
    expect(err?.message).toContain("--semantic");
  });

  it("validates top-k as an integer in the 1..10 range", () => {
    expect(validatePickTopKOption("1")).toBeUndefined();
    expect(validatePickTopKOption("10")).toBeUndefined();
    expect(validatePickTopKOption("0")?.reason).toBe("invalid_input");
    expect(validatePickTopKOption("11")?.reason).toBe("invalid_input");
    expect(validatePickTopKOption("2.5")?.reason).toBe("invalid_input");
    expect(validatePickTopKOption("abc")?.reason).toBe("invalid_input");
  });

  it("registered command rejects invalid --semantic before calling the service", async () => {
    const result = await runPickCommand(
      "/tmp/project",
      "--query",
      "bright",
      "--semantic",
      "remote"
    );

    expect(process.exitCode).toBe(3);
    expect(result.reason).toBe("invalid_input");
    expect(result.message).toContain("--semantic");
    expect(pickServiceMock).not.toHaveBeenCalled();
    expect(buildTextRankerProviderMock).not.toHaveBeenCalled();
  });

  it("registered command rejects invalid --top-k before calling the service", async () => {
    const result = await runPickCommand("/tmp/project", "--query", "bright", "--top-k", "0");

    expect(process.exitCode).toBe(3);
    expect(result.reason).toBe("invalid_input");
    expect(result.message).toContain("--top-k");
    expect(pickServiceMock).not.toHaveBeenCalled();
    expect(buildTextRankerProviderMock).not.toHaveBeenCalled();
  });

  it("registered command returns ai_ranking_failed when explicit AI provider setup fails", async () => {
    buildTextRankerProviderMock.mockRejectedValueOnce(
      new Error(`missing api key sk-${"c".repeat(40)}`)
    );

    const result = await runPickCommand("/tmp/project", "--query", "bright", "--semantic", "ai");

    expect(process.exitCode).toBe(4);
    expect(result.reason).toBe("ai_ranking_failed");
    expect(result.message).toContain("AI ranking provider setup failed");
    expect(result.message).not.toContain(`sk-${"c".repeat(40)}`);
    expect(buildTextRankerProviderMock).toHaveBeenCalledOnce();
    expect(pickServiceMock).not.toHaveBeenCalled();
  });

  it("does not build a ranker when no query is present", async () => {
    await expect(
      buildPickDeps("/tmp/project", parsePickOptions({ category: "bathroom" }))
    ).resolves.toEqual({});
  });
});

async function runPickCommand(...args: string[]): Promise<{ reason?: string; message?: string }> {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const program = new Command().exitOverride().option("--json");
  registerPickCommand(program);

  await program.parseAsync(["node", "smart-img", "--json", "pick", ...args]);

  return JSON.parse(writes.join("")) as { reason?: string; message?: string };
}
