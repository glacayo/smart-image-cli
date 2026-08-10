import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const pickServiceMock = vi.hoisted(() =>
  vi.fn(async () => ({
    result: { ok: true, status: "success", command: "pick" },
    exitCode: 0
  }))
);
const buildTextRankerProviderMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/app/pick-service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/pick-service.js")>();
  return { ...actual, pickService: pickServiceMock };
});

vi.mock("../../src/app/runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/runtime.js")>();
  return { ...actual, buildTextRankerProvider: buildTextRankerProviderMock };
});

import {
  buildPickDeps,
  composePixabayQuery,
  parsePickOptions,
  registerPickCommand,
  validatePickEnumOption,
  validatePickTopKOption
} from "../../src/commands/pick.js";
import { LocalTextRanker } from "../../src/adapters/vision/local-text-ranker.js";
import { orientationParam } from "../../src/domain/pixabay-renditions.js";

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

  it("accepts local|pixabay sources and rejects unsplash at enum validation", () => {
    expect(validatePickEnumOption("source", "local")).toBeUndefined();
    expect(validatePickEnumOption("source", "pixabay")).toBeUndefined();
    expect(parsePickOptions({ source: "local" })).toMatchObject({ source: "local" });
    expect(parsePickOptions({ source: "pixabay", query: "kitchen" })).toMatchObject({
      source: "pixabay",
      query: "kitchen"
    });
    const unsplash = validatePickEnumOption("source", "unsplash");
    expect(unsplash?.reason).toBe("invalid_input");
    expect(unsplash?.message).toMatch(/local,\s*pixabay/);
    expect(unsplash?.message).toContain('got: "unsplash"');
    expect(unsplash?.message).not.toMatch(/config unsplash setup|unsplash\.com\/developers|migration/i);
    const remote = validatePickEnumOption("source", "remote");
    expect(remote?.reason).toBe("invalid_input");
    expect(remote?.message).toContain("--source");
  });

  it("registered command rejects --source unsplash before service without migration guidance", async () => {
    const missingQuery = await runPickCommand("/tmp/project", "--source", "unsplash");
    expect(process.exitCode).toBe(3);
    expect(missingQuery.reason).toBe("invalid_input");
    expect(missingQuery.message).toMatch(/--source must be one of:\s*local,\s*pixabay/);
    expect(missingQuery.message).toContain('got: "unsplash"');
    expect(missingQuery.message).not.toMatch(
      /requires --query|config unsplash setup|unsplash\.com\/developers|migration|missing_unsplash/i
    );
    expect(pickServiceMock).not.toHaveBeenCalled();
    expect(buildTextRankerProviderMock).not.toHaveBeenCalled();

    pickServiceMock.mockClear();
    process.exitCode = undefined;
    const withQuery = await runPickCommand(
      "/tmp/project",
      "--source",
      "unsplash",
      "--query",
      "wide skyline",
      "--orientation",
      "panorama"
    );
    expect(process.exitCode).toBe(3);
    expect(withQuery.reason).toBe("invalid_input");
    expect(withQuery.message).toMatch(/local,\s*pixabay/);
    expect(withQuery.message).not.toMatch(/does not support --orientation panorama/i);
    expect(pickServiceMock).not.toHaveBeenCalled();
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

  it("accepts explicit pixabay source, default safesearch, and orientation mapping (no local fallback)", async () => {
    expect(validatePickEnumOption("source", "pixabay")).toBeUndefined();
    expect(parsePickOptions({ source: "pixabay", query: "kitchen" })).toMatchObject({
      source: "pixabay",
      query: "kitchen",
      safeSearch: true
    });
    expect(
      parsePickOptions({ source: "pixabay", query: "kitchen", safesearch: "false" })
    ).toMatchObject({ source: "pixabay", safeSearch: false });
    expect(orientationParam("landscape")).toBe("horizontal");
    expect(orientationParam("portrait")).toBe("vertical");
    expect(orientationParam("square")).toBeUndefined();
    expect(orientationParam("panorama")).toBe("horizontal");

    const result = await runPickCommand(
      "/tmp/project",
      "--source",
      "pixabay",
      "--query",
      "kitchen",
      "--orientation",
      "landscape",
      "--category",
      "interior"
    );

    expect(process.exitCode).toBe(0);
    expect(result.reason).toBeUndefined();
    expect(pickServiceMock).toHaveBeenCalledOnce();
    expect(buildTextRankerProviderMock).not.toHaveBeenCalled();
    const [, options, deps] = pickServiceMock.mock.calls[0]!;
    expect(options).toMatchObject({
      source: "pixabay",
      query: "kitchen",
      orientation: "landscape",
      category: "interior",
      safeSearch: true
    });
    // Explicit pixabay wires credential resolver only — never local ranker/index.
    expect(typeof deps?.resolvePixabayCredential).toBe("function");
    expect(deps).not.toHaveProperty("textRanker");
    expect(deps).not.toHaveProperty("index");
  });

  it("rejects missing query, oversized composed q, and invalid safesearch before any service call", async () => {
    const missing = await runPickCommand("/tmp/project", "--source", "pixabay");
    expect(process.exitCode).toBe(3);
    expect(missing.reason).toBe("invalid_input");
    expect(missing.message).toContain("--source pixabay requires --query");
    expect(pickServiceMock).not.toHaveBeenCalled();

    pickServiceMock.mockClear();
    process.exitCode = undefined;
    const long = "k".repeat(101);
    const oversized = await runPickCommand(
      "/tmp/project",
      "--source",
      "pixabay",
      "--query",
      long
    );
    expect(process.exitCode).toBe(3);
    expect(oversized.reason).toBe("invalid_input");
    expect(oversized.message).toMatch(/100|query/i);
    expect(pickServiceMock).not.toHaveBeenCalled();

    // Composed q = query + unique categories must also stay ≤ 100.
    expect(composePixabayQuery({ category: "spa" }, "hero")).toBe("hero spa");
    expect(composePixabayQuery({ category: "spa", categories: ["spa", "bath"] }, "hero")).toBe(
      "hero spa bath"
    );
    pickServiceMock.mockClear();
    process.exitCode = undefined;
    const q = "q".repeat(90);
    const cat = "abcdefghijk"; // 90 + 1 + 11 = 102
    expect(composePixabayQuery({ category: cat }, q).length).toBe(102);
    const composed = await runPickCommand(
      "/tmp/project",
      "--source",
      "pixabay",
      "--query",
      q,
      "--category",
      cat
    );
    expect(process.exitCode).toBe(3);
    expect(composed.reason).toBe("invalid_input");
    expect(pickServiceMock).not.toHaveBeenCalled();

    pickServiceMock.mockClear();
    process.exitCode = undefined;
    const badSafe = await runPickCommand(
      "/tmp/project",
      "--source",
      "pixabay",
      "--query",
      "kitchen",
      "--safesearch",
      "maybe"
    );
    expect(process.exitCode).toBe(3);
    expect(badSafe.reason).toBe("invalid_input");
    expect(badSafe.message).toContain("--safesearch");
    expect(pickServiceMock).not.toHaveBeenCalled();

    // Boundary: exactly 100 chars is accepted and reaches the service.
    pickServiceMock.mockClear();
    process.exitCode = undefined;
    const exact = "e".repeat(100);
    await runPickCommand("/tmp/project", "--source", "pixabay", "--query", exact);
    expect(process.exitCode).toBe(0);
    expect(pickServiceMock).toHaveBeenCalledOnce();
    expect(pickServiceMock.mock.calls[0]![1]).toMatchObject({ query: exact, source: "pixabay" });
  });

  it("allows pixabay panorama, honors safesearch=false, and never accepts API key flags", async () => {
    const panorama = await runPickCommand(
      "/tmp/project",
      "--source",
      "pixabay",
      "--query",
      "wide coast",
      "--orientation",
      "panorama",
      "--safesearch",
      "false"
    );
    expect(process.exitCode).toBe(0);
    expect(panorama.reason).toBeUndefined();
    expect(pickServiceMock).toHaveBeenCalledOnce();
    expect(pickServiceMock.mock.calls[0]![1]).toMatchObject({
      source: "pixabay",
      orientation: "panorama",
      safeSearch: false,
      query: "wide coast"
    });

    // No secret flags; help lists local|pixabay only (unsplash removed).
    const program = new Command().exitOverride().option("--json");
    registerPickCommand(program);
    const pick = program.commands.find((c) => c.name() === "pick");
    const flags = pick?.options.map((o) => o.flags).join(" ") ?? "";
    const help = pick?.options.map((o) => `${o.flags} ${o.description}`).join("\n") ?? "";
    expect(flags).not.toMatch(/api[-]?key/i);
    expect(flags).not.toMatch(/access[-]?key/i);
    expect(flags).toContain("--safesearch");
    expect(help).toMatch(/local,\s*pixabay|local \| pixabay|local or pixabay/i);
    expect(help).not.toMatch(/\bunsplash\b/i);
    expect(help).toMatch(/no cross-source fallback/i);
  });

  it("does not build local ranker deps for pixabay even when semantic is set", async () => {
    await expect(
      buildPickDeps(
        "/tmp/project",
        parsePickOptions({ source: "pixabay", query: "kitchen", semantic: "local" })
      )
    ).resolves.toMatchObject({ resolvePixabayCredential: expect.any(Function) });
    expect(buildTextRankerProviderMock).not.toHaveBeenCalled();
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
