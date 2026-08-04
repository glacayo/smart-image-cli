import { describe, expect, it } from "vitest";
import {
  PANORAMA_MIN,
  SQUARE_MAX,
  SQUARE_MIN,
  aspectBand,
  orientationParam,
  selectRendition,
  type PixabayHit,
  type RenditionChoice
} from "../../src/domain/pixabay-renditions.js";

const FULL = {
  fullHDURL: "https://cdn.example/fullhd.jpg",
  imageURL: "https://cdn.example/source.jpg"
} as const;

function hit(
  partial: Partial<PixabayHit> & Pick<PixabayHit, "imageWidth" | "imageHeight">
): PixabayHit {
  return {
    id: 1,
    webformatURL: "https://cdn.example/web.jpg",
    largeImageURL: "https://cdn.example/large.jpg",
    ...partial
  };
}

describe("aspectBand", () => {
  it("exports the design band constants", () => {
    expect(SQUARE_MIN).toBe(0.9);
    expect(SQUARE_MAX).toBe(1.1);
    expect(PANORAMA_MIN).toBe(2.0);
  });

  it.each([
    // ratio = w/h — design D2 boundaries
    { width: 899, height: 1000, expected: "portrait" }, // 0.899
    { width: 900, height: 1000, expected: "square" }, // 0.9
    { width: 1000, height: 1000, expected: "square" }, // 1.0
    { width: 1100, height: 1000, expected: "square" }, // 1.1
    { width: 1101, height: 1000, expected: "landscape" }, // 1.101
    { width: 1778, height: 1000, expected: "landscape" }, // 1.778 (16:9)
    { width: 1999, height: 1000, expected: "landscape" }, // 1.999
    { width: 2000, height: 1000, expected: "panorama" }, // 2.0
    { width: 3000, height: 1000, expected: "panorama" }, // 3.0
    { width: 800, height: 1000, expected: "portrait" }, // 0.8 (4:5)
    { width: 1250, height: 1000, expected: "landscape" } // 1.25 (5:4)
  ] as const)("classifies $width×$height as $expected", ({ width, height, expected }) => {
    expect(aspectBand(width, height)).toBe(expected);
  });
});

describe("orientationParam", () => {
  it("maps bands to the Pixabay API pre-filter (D3)", () => {
    expect(orientationParam("landscape")).toBe("horizontal");
    expect(orientationParam("panorama")).toBe("horizontal");
    expect(orientationParam("portrait")).toBe("vertical");
    expect(orientationParam("square")).toBeUndefined();
  });
});

describe("selectRendition", () => {
  const source4k = hit({ imageWidth: 4000, imageHeight: 3000, ...FULL });

  it.each([
    {
      name: "smallest rung (webformat ~640)",
      req: { width: 400, height: 300 },
      want: { ok: true, url: "https://cdn.example/web.jpg", dims: { width: 640, height: 480 } }
    },
    {
      name: "steps to largeImageURL (~1280)",
      req: { width: 1000, height: 750 },
      want: { ok: true, url: "https://cdn.example/large.jpg", dims: { width: 1280, height: 960 } }
    },
    {
      name: "fullHDURL when request exceeds 1280",
      req: { width: 1500, height: 1000 },
      want: {
        ok: true,
        url: "https://cdn.example/fullhd.jpg",
        dims: { width: 1920, height: 1440 }
      }
    },
    {
      name: "imageURL when request exceeds fullHD but fits source",
      req: { width: 3000, height: 2000 },
      want: {
        ok: true,
        url: "https://cdn.example/source.jpg",
        dims: { width: 4000, height: 3000 }
      }
    },
    {
      name: "width-only request uses matching edge",
      req: { width: 1200 },
      want: { ok: true, url: "https://cdn.example/large.jpg", dims: { width: 1280, height: 960 } }
    }
  ] as const)("$name", ({ req, want }) => {
    expect(selectRendition(source4k, req)).toEqual(want);
  });

  it("returns source_too_small when native source cannot satisfy the request", () => {
    const choice = selectRendition(
      hit({ imageWidth: 2000, imageHeight: 1500, ...FULL }),
      { width: 3000, height: 2000 }
    );
    expect(choice).toEqual({ ok: false, reason: "source_too_small" });
  });

  it("succeeds with resolution_cap when the free tier is capped below the request", () => {
    const choice: RenditionChoice = selectRendition(
      hit({ imageWidth: 4000, imageHeight: 3000 }),
      { width: 1500, height: 1000 }
    );
    expect(choice).toEqual({
      ok: true,
      url: "https://cdn.example/large.jpg",
      dims: { width: 1280, height: 960 },
      warning: {
        code: "resolution_cap",
        requested: { width: 1500, height: 1000 },
        delivered: { width: 1280, height: 960 },
        maxRenditionEdge: 1280,
        cause: "full_api_access_unavailable"
      }
    });
  });

  it("never enlarges a small source past native dims", () => {
    // Long edge 800: webformat (640) fails; large clamps to source and wins.
    const choice = selectRendition(
      hit({ imageWidth: 800, imageHeight: 600, ...FULL }),
      { width: 700, height: 500 }
    );
    expect(choice).toEqual({
      ok: true,
      url: "https://cdn.example/large.jpg",
      dims: { width: 800, height: 600 }
    });
  });
});
