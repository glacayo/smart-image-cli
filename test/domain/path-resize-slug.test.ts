import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PathEscapeError,
  generatedDirsForRoot,
  isGeneratedAssetPath,
  resolveInside,
  shouldExcludeByGeneratedDirPredicate
} from "../../src/domain/path-guard.js";
import { planResize } from "../../src/domain/resize-planner.js";
import { buildImageFileName, sanitizeSlug } from "../../src/domain/slug-namer.js";

describe("Phase 4 domain safety contracts", () => {
  it("rejects traversal that escapes the configured root", () => {
    const root = path.resolve("/project/root");

    expect(() => resolveInside(root, "../escape.jpg")).toThrow(PathEscapeError);
  });

  it("uses segment-aware generated-asset exclusion without sibling prefix overmatch", () => {
    const root = path.resolve("/project/root");
    const outDir = path.join(root, "_out");

    expect(shouldExcludeByGeneratedDirPredicate(path.join(root, "_out"), outDir)).toBe(true);
    expect(shouldExcludeByGeneratedDirPredicate(path.join(root, "_out", "hero.jpg"), outDir)).toBe(
      true
    );
    expect(shouldExcludeByGeneratedDirPredicate(path.join(root, "_outdoor", "hero.jpg"), outDir)).toBe(
      false
    );
  });

  it("includes default and configured generated directories under the root only", () => {
    const root = path.resolve("/project/root");
    const ignored = generatedDirsForRoot(root, ["dist/assets"]);

    expect(ignored).toContain(path.join(root, ".img-ia"));
    expect(ignored).toContain(path.join(root, "_out"));
    expect(ignored).toContain(path.join(root, "dist", "assets"));
    expect(isGeneratedAssetPath(path.join(root, "dist", "assets", "hero.webp"), ignored)).toBe(
      true
    );
    expect(isGeneratedAssetPath(path.join(root, "dist-assets", "hero.webp"), ignored)).toBe(false);
  });

  it("refuses explicit resize targets that exceed source dimensions", () => {
    const sourceWidth = 1200;
    const sourceHeight = 800;
    const requestedWidth = 1800; // larger than sourceWidth -> must refuse
    const result = planResize(
      { width: sourceWidth, height: sourceHeight },
      { format: "webp", width: requestedWidth }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("target_exceeds_source");
      expect(result.source).toEqual({ width: sourceWidth, height: sourceHeight });
    }
  });

  it("downscales inside max bounds without enlarging", () => {
    const sourceWidth = 4000;
    const sourceHeight = 2000;
    const maxWidth = 1600; // half the source width -> height halves to 800
    const expectedHeight = 800;
    const result = planResize(
      { width: sourceWidth, height: sourceHeight },
      { format: "avif", maxWidth }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.width).toBe(maxWidth);
      expect(result.height).toBe(expectedHeight);
      expect(result.withoutEnlargement).toBe(true);
      expect(result.quality).toBe(50);
    }
  });

  it("sanitizes unsafe generated slugs and Windows reserved names", () => {
    expect(sanitizeSlug("CON")).toBe("con-image");
    expect(sanitizeSlug("Café / Kitchen: Before & After?"))
      .toBe("cafe-kitchen-before-and-after");
  });

  it("adds deterministic sequence and sha collision suffixes to generated filenames", () => {
    const name = buildImageFileName({
      suggestedSlug: "Hero Kitchen",
      sequence: 2,
      sha256: "abcdef1234567890",
      extension: ".JPG",
      collision: true
    });

    expect(name).toBe("hero-kitchen-002-abcdef12.jpg");
  });
});
