import { describe, expect, it } from "vitest";
import path from "node:path";
import { PathEscapeError, generatedDirsForRoot } from "../../src/domain/path-guard.js";
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

describe("project-config secret-value rejection", () => {
  // Build provider-shaped fixtures dynamically so no committed literal looks
  // like a real provider token. The assembled value still starts with a known
  // provider prefix so the secret-value guard rejects it.
  function buildSkToken(body: string): string {
    return `${["sk", "proj"].join("-")}-${body}`;
  }

  it("rejects a secret-looking key name", () => {
    expect(() => parseProjectConfig({ apiKey: "anything" })).toThrow(/provider secrets/);
  });

  it("rejects a URL with embedded credentials as a value", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://user:pass@host.com" } })
    ).toThrow(/secret-looking values/);
  });

  it("rejects a URL with only a token username (token@host)", () => {
    expect(() => parseProjectConfig({ provider: { endpoint: "https://token@host.com" } })).toThrow(
      /secret-looking values/
    );
  });

  it("rejects a URL with only a password (:pass@host)", () => {
    expect(() => parseProjectConfig({ provider: { endpoint: "https://:pass@host.com" } })).toThrow(
      /secret-looking values/
    );
  });

  it("rejects a query-param token in a URL value", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com?api_key=abc123def456" } })
    ).toThrow(/secret-looking values/);
  });

  it("rejects a fragment-param token in a URL value", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com#token=abc123def456" } })
    ).toThrow(/secret-looking values/);
  });

  it("rejects a fragment access_token param in a URL value", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com#access_token=abc123def456" } })
    ).toThrow(/secret-looking values/);
  });

  it("rejects a fragment api_key param in a URL value", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com#api_key=abc123def456" } })
    ).toThrow(/secret-looking values/);
  });

  it("rejects a fragment secret param in a URL value", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com#secret=abc123def456" } })
    ).toThrow(/secret-looking values/);
  });

  it("rejects a query refresh_token param in a URL value", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com?refresh_token=abc123def456" } })
    ).toThrow(/secret-looking values/);
  });

  it("rejects a fragment id_token param in a URL value", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com#id_token=abc123def456" } })
    ).toThrow(/secret-looking values/);
  });

  it("rejects a query client_secret param in a URL value", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com?client_secret=abc123def456" } })
    ).toThrow(/secret-looking values/);
  });

  it("rejects a query key param in a URL value", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com?key=abc123def456" } })
    ).toThrow(/secret-looking values/);
  });

  it("rejects encoded query-param names that decode to secret names", () => {
    expect(() =>
      parseProjectConfig({
        provider: { endpoint: "https://host.com?client%5Fsecret=abc123def456" }
      })
    ).toThrow(/secret-looking values/);
    expect(() =>
      parseProjectConfig({
        provider: { endpoint: "https://host.com?refresh%2Dtoken=abc123def456" }
      })
    ).toThrow(/secret-looking values/);
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com?api%2Dkey=abc123def456" } })
    ).toThrow(/secret-looking values/);
  });

  it("rejects encoded fragment-param names that decode to secret names", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com#access%5Ftoken=abc123def456" } })
    ).toThrow(/secret-looking values/);
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com#id%2Dtoken=abc123def456" } })
    ).toThrow(/secret-looking values/);
  });

  it("does not reject non-secret encoded query params", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com?foo%2Dbar=somevalue" } })
    ).not.toThrow();
  });

  it("rejects hyphenated and upper-case variants of secret param names", () => {
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com?API-KEY=abc123def456" } })
    ).toThrow(/secret-looking values/);
    expect(() =>
      parseProjectConfig({ provider: { endpoint: "https://host.com#Refresh-Token=abc123def456" } })
    ).toThrow(/secret-looking values/);
  });

  it("rejects a refresh_token key name in project config", () => {
    expect(() => parseProjectConfig({ refresh_token: "anything" })).toThrow(/provider secrets/);
  });

  it("rejects a client_secret key name in project config", () => {
    expect(() => parseProjectConfig({ client_secret: "anything" })).toThrow(/provider secrets/);
  });

  it("rejects a Bearer header value", () => {
    expect(() => parseProjectConfig({ provider: { model: "Bearer abc123def456ghi789" } })).toThrow(
      /secret-looking values/
    );
  });

  it("rejects a known-prefix provider token as a value", () => {
    const token = buildSkToken("abcdefghijklmnopqrstuvwxyz123456");
    expect(() => parseProjectConfig({ provider: { model: token } })).toThrow(
      /secret-looking values/
    );
  });

  it("rejects a long high-entropy blob as a value", () => {
    const blob = "A".repeat(44);
    expect(() => parseProjectConfig({ provider: { model: blob } })).toThrow(
      /secret-looking values/
    );
  });

  it("does not reject a plain sha256 hash value", () => {
    const hash = "a".repeat(64);
    // A 64-char lowercase hex string is a sha256 hash, not a secret. The guard
    // must accept it as a value (e.g. in a model field) without rejecting it.
    expect(() => parseProjectConfig({ provider: { model: hash } })).not.toThrow();
    const cfg = parseProjectConfig({ provider: { model: hash } });
    expect(cfg.provider?.model).toBe(hash);
  });

  it("rejects a secret-shaped value nested in an array", () => {
    const token = buildSkToken("abcdefghijklmnopqrstuvwxyz123456");
    expect(() => parseProjectConfig({ categories: [{ name: "x", slug: token }] })).toThrow(
      /secret-looking values/
    );
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
