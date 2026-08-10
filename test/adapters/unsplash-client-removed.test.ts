import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const adapterPath = path.join(repoRoot, "src/adapters/unsplash-client.ts");
const dedicatedTestPath = path.join(repoRoot, "test/adapters/unsplash-client.test.ts");

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("Unsplash HTTP client removal (WU6a2)", () => {
  it("deletes the orphaned adapter and keeps production free of unsplash-client imports", () => {
    expect(fs.existsSync(adapterPath), "src/adapters/unsplash-client.ts must be deleted").toBe(
      false
    );
    expect(
      fs.existsSync(dedicatedTestPath),
      "test/adapters/unsplash-client.test.ts must be deleted"
    ).toBe(false);

    const productionFiles = walkTsFiles(path.join(repoRoot, "src"));
    const offenders: string[] = [];
    for (const file of productionFiles) {
      const text = fs.readFileSync(file, "utf8");
      if (
        /from\s+["'][^"']*unsplash-client(?:\.js)?["']/.test(text) ||
        /import\s*\(\s*["'][^"']*unsplash-client(?:\.js)?["']\s*\)/.test(text) ||
        /new\s+UnsplashClient\b/.test(text)
      ) {
        offenders.push(path.relative(repoRoot, file).split("\\").join("/"));
      }
    }
    expect(offenders, "no production import/construction of unsplash-client").toEqual([]);
  });
});
