const WINDOWS_RESERVED_BASENAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const UNSAFE_FILENAME_CHARS = '<>:"/\\|?*';
const COMBINING_MARKS = /\p{Mark}+/gu;

export type SlugOptions = {
  fallback?: string;
  maxLength?: number;
};

export type ImageFileNameInput = {
  suggestedSlug: string;
  sequence: number;
  sha256?: string;
  extension: string;
  collision?: boolean;
  maxSlugLength?: number;
};

export function sanitizeSlug(input: string, options: SlugOptions = {}): string {
  const fallback = options.fallback ?? "image";
  const maxLength = options.maxLength ?? 80;
  const normalized = input.normalize("NFKC").normalize("NFKD").replace(COMBINING_MARKS, "");
  const slug = normalized
    .toLowerCase()
    .replace(/&/g, " and ")
    .split("")
    .map((char) => (isUnsafeFilenameChar(char) ? "-" : char))
    .join("")
    .replace(/[\s_.]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");

  const safeSlug = slug.length > 0 ? slug : fallback;

  if (WINDOWS_RESERVED_BASENAMES.test(safeSlug)) {
    return `${safeSlug}-image`;
  }

  return safeSlug;
}

export function formatSequence(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Sequence must be a positive integer");
  }

  return String(sequence).padStart(3, "0");
}

export function buildImageFileName(input: ImageFileNameInput): string {
  const slugOptions: SlugOptions = {};
  if (input.maxSlugLength !== undefined) {
    slugOptions.maxLength = input.maxSlugLength;
  }

  const slug = sanitizeSlug(input.suggestedSlug, slugOptions);
  const extension = normalizeExtension(input.extension);
  const suffix = input.collision && input.sha256 ? `-${input.sha256.slice(0, 8)}` : "";

  return `${slug}-${formatSequence(input.sequence)}${suffix}.${extension}`;
}

export function withDeterministicCollisionSuffix(slug: string, sha256: string): string {
  return `${sanitizeSlug(slug)}-${sha256.slice(0, 8)}`;
}

function normalizeExtension(extension: string): string {
  return extension.replace(/^\.+/, "").toLowerCase();
}

function isUnsafeFilenameChar(char: string): boolean {
  return char.charCodeAt(0) < 32 || UNSAFE_FILENAME_CHARS.includes(char);
}
