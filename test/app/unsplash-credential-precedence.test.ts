import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Unsplash credential resolver removed (WU6c1)", () => {
  it("runtime exports no Unsplash credential resolver, error, or guidance symbols", async () => {
    const runtime = await import("../../src/app/runtime.js");
    expect(runtime).not.toHaveProperty("resolveUnsplashCredential");
    expect(runtime).not.toHaveProperty("MissingUnsplashCredentialError");
    expect(runtime).not.toHaveProperty("ResolvedUnsplashCredential");

    const text = fs.readFileSync(path.join(repoRoot, "src/app/runtime.ts"), "utf8");
    expect(text).not.toMatch(/\bresolveUnsplashCredential\b/);
    expect(text).not.toMatch(/\bMissingUnsplashCredentialError\b/);
    expect(text).not.toMatch(/\bResolvedUnsplashCredential\b/);
    expect(text).not.toMatch(/\bUNSPLASH_ACCESS_KEY\b/);
    expect(text).not.toMatch(/unsplash\.com\/developers|missing_unsplash_credential|config unsplash setup/i);

    const schema = fs.readFileSync(path.join(repoRoot, "src/config/user-config.ts"), "utf8");
    expect(schema).not.toMatch(/\bunsplashConfigSchema\b/);
    expect(schema).not.toMatch(/\bUnsplashConfig\b/);
    expect(schema).not.toMatch(/unsplash:\s*unsplashConfigSchema/);
  });
});
