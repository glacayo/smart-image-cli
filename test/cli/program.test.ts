import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/program.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readPackageJson(): Record<string, unknown> {
  const raw = readFileSync(path.join(repoRoot, "package.json"), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("public CLI command name and package bin contract", () => {
  it("exposes the program under the smart-img command name", () => {
    const program = createProgram();
    expect(program.name()).toBe("smart-img");
  });

  it("reports the 0.3.0 runtime version", () => {
    const program = createProgram();
    expect(program.version()).toBe("0.3.0");
  });

  it("package.json declares the exact two-bin contract and img points to the migration entry", () => {
    const pkg = readPackageJson();
    expect(pkg["version"]).toBe("0.3.0");
    const bin = pkg["bin"] as Record<string, string> | undefined;
    expect(bin).toBeDefined();
    // Exactly two bins: smart-img (functional) and img (temporary migration entry).
    expect(Object.keys(bin ?? {}).sort()).toEqual(["img", "smart-img"]);
    expect(bin?.["smart-img"]).toBe("dist/cli/program.js");
    // The legacy command points to dist/cli/output.js, whose direct-run guard
    // emits the migration message and exits non-zero. When imported by the
    // functional CLI it preserves all existing output behavior with no side effects.
    expect(bin?.["img"]).toBe("dist/cli/output.js");
  });
});