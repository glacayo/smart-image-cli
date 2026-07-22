import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  PathEscapeError,
  generatedDirsForRoot
} from "../../src/domain/path-guard.js";
import { parseProjectConfig } from "../../src/config/project-config.js";

describe("project-config outputDirs validation", () => {
  it("parses default outputDirs", () => {
    const cfg = parseProjectConfig({});
    expect(cfg.outputDirs).toEqual(["_out"]);
  });

  it("accepts a valid nested root-relative outputDir", () => {
    const cfg = parseProjectConfig({ outputDirs: ["_out/nested"] });
    expect(cfg.outputDirs).toEqual(["_out/nested"]);
  });

  it("rejects an absolute outputDir at parse time", () => {
    expect(() => parseProjectConfig({ outputDirs: ["/_out"] })).toThrow();
  });

  it("rejects a parent traversal outputDir at parse time", () => {
    expect(() => parseProjectConfig({ outputDirs: ["../escape"] })).toThrow();
  });

  it("rejects an empty-segment outputDir at parse time", () => {
    expect(() => parseProjectConfig({ outputDirs: ["a//b"] })).toThrow();
  });
});

describe("generatedDirsForRoot cannot resolve exclusions outside root", () => {
  const root = process.platform === "win32" ? "C:\\project" : "/project";

  it("resolves defaults inside root", () => {
    const dirs = generatedDirsForRoot(root);
    for (const dir of dirs) {
      expect(path.relative(root, dir)).not.toMatch(/^\.\./);
    }
  });

  it("resolves a valid configured dir inside root", () => {
    const dirs = generatedDirsForRoot(root, ["_out/custom"]);
    for (const dir of dirs) {
      expect(path.relative(root, dir)).not.toMatch(/^\.\./);
    }
  });

  it("rejects a configured absolute path that escapes root", () => {
    expect(() => generatedDirsForRoot(root, ["/outside"])).toThrow(PathEscapeError);
  });

  it("rejects a configured parent-traversal path that escapes root", () => {
    expect(() => generatedDirsForRoot(root, ["../sibling"])).toThrow(PathEscapeError);
  });
});