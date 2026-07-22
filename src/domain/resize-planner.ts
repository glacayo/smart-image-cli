export type ImageFormat = "jpg" | "jpeg" | "png" | "webp" | "avif";

export type ImageInfo = {
  width: number;
  height: number;
  format?: ImageFormat;
};

export type ResizeTarget = {
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
  mode?: "resize" | "crop";
  format: ImageFormat;
  quality?: number;
  keepMetadata?: boolean;
};

export type ResizePlan = {
  ok: true;
  op: "resize" | "crop";
  width: number;
  height: number;
  format: ImageFormat;
  quality: number;
  keepMetadata: boolean;
  withoutEnlargement: true;
};

export type ResizeUnsatisfiable = {
  ok: false;
  reason: "target_exceeds_source";
  source: { width: number; height: number };
  requested: ResizeTarget;
};

export function planResize(
  source: ImageInfo,
  target: ResizeTarget
): ResizePlan | ResizeUnsatisfiable {
  assertPositiveDimensions(source.width, source.height);
  assertRequestedBounds(target);

  if (
    (target.width !== undefined && target.width > source.width) ||
    (target.height !== undefined && target.height > source.height)
  ) {
    return {
      ok: false,
      reason: "target_exceeds_source",
      source: { width: source.width, height: source.height },
      requested: target
    };
  }

  const size =
    target.mode === "crop" && target.width !== undefined && target.height !== undefined
      ? { width: target.width, height: target.height }
      : fitWithinBounds(source, target);

  return {
    ok: true,
    op: target.mode ?? "resize",
    width: size.width,
    height: size.height,
    format: target.format,
    quality: target.quality ?? defaultQualityFor(target.format),
    keepMetadata: target.keepMetadata ?? false,
    withoutEnlargement: true
  };
}

function fitWithinBounds(
  source: ImageInfo,
  target: ResizeTarget
): { width: number; height: number } {
  const requestedWidth = target.width ?? target.maxWidth ?? source.width;
  const requestedHeight = target.height ?? target.maxHeight ?? source.height;
  const widthLimit = Math.min(requestedWidth, source.width);
  const heightLimit = Math.min(requestedHeight, source.height);
  const ratio = Math.min(widthLimit / source.width, heightLimit / source.height, 1);

  return {
    width: Math.max(1, Math.round(source.width * ratio)),
    height: Math.max(1, Math.round(source.height * ratio))
  };
}

function defaultQualityFor(format: ImageFormat): number {
  switch (format) {
    case "avif":
      return 50;
    case "webp":
      return 82;
    case "jpg":
    case "jpeg":
      return 82;
    case "png":
      return 90;
  }
}

function assertPositiveDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Image dimensions must be positive integers");
  }
}

function assertRequestedBounds(target: ResizeTarget): void {
  for (const value of [target.width, target.height, target.maxWidth, target.maxHeight]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new Error("Requested dimensions must be positive integers");
    }
  }
}
