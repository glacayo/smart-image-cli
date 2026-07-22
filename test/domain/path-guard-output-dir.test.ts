import { describe, expect, it } from "vitest";
import { PathEscapeError, assertRootRelativeOutputDir } from "../../src/domain/path-guard.js";

describe("assertRootRelativeOutputDir", () => {
  it("accepts a simple root-relative name", () => {
    expect(assertRootRelativeOutputDir("_out")).toBe("_out");
  });

  it("accepts a nested root-relative path", () => {
    expect(assertRootRelativeOutputDir("_out/nested")).toBe("_out/nested");
  });

  it("accepts a dotfile directory name", () => {
    expect(assertRootRelativeOutputDir(".img-ia")).toBe(".img-ia");
  });

  it("accepts backslash-separated paths and normalizes to posix", () => {
    expect(assertRootRelativeOutputDir("_out\\nested")).toBe("_out/nested");
  });

  it("rejects an absolute POSIX path", () => {
    expect(() => assertRootRelativeOutputDir("/_out")).toThrow(PathEscapeError);
  });

  it("rejects an absolute Windows path", () => {
    expect(() => assertRootRelativeOutputDir("C:\\_out")).toThrow(PathEscapeError);
  });

  it("rejects a Windows drive-relative path", () => {
    expect(() => assertRootRelativeOutputDir("C:_out")).toThrow(PathEscapeError);
  });

  it("rejects a parent traversal escape", () => {
    expect(() => assertRootRelativeOutputDir("../sibling")).toThrow(PathEscapeError);
  });

  it("rejects a nested parent traversal escape", () => {
    expect(() => assertRootRelativeOutputDir("_out/../../escape")).toThrow(PathEscapeError);
  });

  it("rejects an empty segment", () => {
    expect(() => assertRootRelativeOutputDir("a//b")).toThrow(PathEscapeError);
  });

  it("rejects a path that normalizes to parent", () => {
    expect(() => assertRootRelativeOutputDir("..")).toThrow(PathEscapeError);
  });

  it("rejects an empty string", () => {
    expect(() => assertRootRelativeOutputDir("")).toThrow(PathEscapeError);
  });
});