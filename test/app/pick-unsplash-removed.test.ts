import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pickSrc = path.join(root, "src/app/pick-service.ts");
const residualTest = path.join(root, "test/app/pick-unsplash-credential.test.ts");
const BANNED =
  /\bpickUnsplashService\b|\bUnsplashClientPort\b|\bUnsplashPhoto\b|\bunsplashClient\b|\bresolveUnsplashCredential\b|\bwriteUnsplashSource\b|\btoUnsplashOrientation\b|\bunsplashQuery\b|"unsplash"|'unsplash'/;
const SKIP =
  /(pick-unsplash-removed|unsplash-.*removed|unsplash-client-removed|unsplash-credential-precedence|user-config-unsplash|pick-source-rejection|pick-semantic-options)\.test\.ts$/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.isFile() && e.name.endsWith(".ts") ? [p] : [];
  });
}

describe("pick-service Unsplash teardown (WU6c3)", () => {
  it("deletes residual port/impl/tests; PickSource is local|pixabay only", () => {
    expect(fs.existsSync(residualTest)).toBe(false);
    const src = fs.readFileSync(pickSrc, "utf8");
    expect(src).toMatch(/export type PickSource = "local" \| "pixabay"/);
    expect(src).not.toMatch(BANNED);
    const hit = [...walk(path.join(root, "src")), ...walk(path.join(root, "test"))]
      .map((f) => path.relative(root, f).split(path.sep).join("/"))
      .filter((rel) => !SKIP.test(rel) && !rel.endsWith("pick-unsplash-removed.test.ts"))
      .filter((rel) =>
        /\bpickUnsplashService\b|\bunsplashClient\b|\bUnsplashClientPort\b|\bwriteUnsplashSource\b/.test(
          fs.readFileSync(path.join(root, rel), "utf8")
        )
      );
    expect(hit).toEqual([]);
  });
});
