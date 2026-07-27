import path from "node:path";
import { z } from "zod";
import { categorySchema } from "../domain/taxonomy.js";
import { assertRootRelativeOutputDir } from "../domain/path-guard.js";

export const projectProviderConfigSchema = z
  .object({
    provider: z.enum(["ollama", "openrouter", "gemini"]).optional(),
    endpoint: z.string().url().optional(),
    model: z.string().min(1).optional()
  })
  .strict();

const outputDirSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    try {
      assertRootRelativeOutputDir(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "invalid outputDirs entry",
        path: []
      });
    }
  });

export const projectConfigSchema = z
  .object({
    provider: projectProviderConfigSchema.optional(),
    categories: z.array(categorySchema).default([]),
    outputDirs: z.array(outputDirSchema).default(["_out"])
  })
  .strict();

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

const SECRET_KEY_PATTERN =
  /(api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|private[-_]?key|auth[-_]?token|bearer[-_]?token|token|secret|password|passwd|pwd|credential)/i;

/**
 * Detects secret-looking *values* (not just key names). Project config must
 * never store provider credentials, so any primitive string value that looks
 * like a secret is rejected at parse time regardless of the key it sits under.
 *
 * Matches:
 * - Any URL userinfo: `scheme://user:pass@host`, `scheme://token@host`,
 *   `scheme://:pass@host` — any username or password in a URL is rejected.
 * - URL query/fragment-param tokens: `?api_key=…`, `&token=…`, `#token=…`,
 *   including percent-encoded param names (`?client%5Fsecret=…`,
 *   `?refresh%2Dtoken=…`) that decode to a known secret-bearing name.
 * - Bearer tokens: `Bearer …`
 * - Known provider-prefixed tokens: `sk-`, `or-`, `AIza`, `gsk_`, `ollama_`
 * - Long high-entropy-looking strings (40+ chars of base64/hex) that are not
 *   plain sha256 hashes.
 */
// Common secret-bearing URL query/fragment parameter names. Covers the
// historically-validated names plus refresh_token, id_token, client_secret,
// key, and related variants; hyphen/underscore/case-insensitive via the
// `[_-]?` optional separators and the `i` flag.
const SECRET_URL_PARAM_NAMES =
  "(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|" +
  "client[_-]?secret|private[_-]?key|auth[_-]?token|bearer[_-]?token|" +
  "token|secret|password|passwd|pwd|credential|key)";

const SECRET_URL_PARAM_NAME_RE = new RegExp(`^${SECRET_URL_PARAM_NAMES}$`, "i");

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /:\/\/[^\s/?#]+@/i, // any URL userinfo (user:pass@, token@, :pass@)
  new RegExp(`[?#&]${SECRET_URL_PARAM_NAMES}=[^\\s&#]+`, "i"), // query/fragment-param token
  /\bBearer\s+[A-Za-z0-9_\-.=]+/i, // Bearer header value
  /^(sk-|sk_|or-|AIza|gsk_|ollama_)/, // known provider prefix at value start
  /^[A-Za-z0-9+/_\-=]{40,}$/ // long high-entropy blob (but not a 64-char hex sha)
];

function looksLikeSecretValue(value: string): boolean {
  // A 64-char lowercase hex string is a sha256 hash, not a secret.
  if (/^[a-f0-9]{64}$/i.test(value)) return false;
  if (SECRET_VALUE_PATTERNS.some((re) => re.test(value))) return true;
  return hasEncodedSecretUrlParam(value);
}

/**
 * Returns true when a string contains a URL query/fragment param whose (possibly
 * percent-encoded) name decodes to a known secret-bearing name. Catches cases the
 * literal regex misses, e.g. `?client%5Fsecret=x`, `?refresh%2Dtoken=x`,
 * `?api%2Dkey=x`, `#access%2Dtoken=y`.
 */
function hasEncodedSecretUrlParam(value: string): boolean {
  const paramRe = /[?#&]([^=?#&\s]+)=[^&#\s]+/g;
  let match: RegExpExecArray | null;
  while ((match = paramRe.exec(value)) !== null) {
    const rawName = match[1];
    if (rawName === undefined) continue;
    if (SECRET_URL_PARAM_NAME_RE.test(rawName)) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawName);
    } catch {
      continue;
    }
    if (decoded !== rawName && SECRET_URL_PARAM_NAME_RE.test(decoded)) return true;
  }
  return false;
}

export function getProjectConfigPath(root: string): string {
  return path.join(root, ".img-ia", "config.json");
}

export function parseProjectConfig(value: unknown): ProjectConfig {
  assertProjectConfigHasNoSecrets(value);
  return projectConfigSchema.parse(value);
}

export function emptyProjectConfig(): ProjectConfig {
  return { categories: [], outputDirs: ["_out"] };
}

export function assertProjectConfigHasNoSecrets(value: unknown, trail: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertProjectConfigHasNoSecrets(item, [...trail, String(index)])
    );
    return;
  }

  if (typeof value === "string") {
    if (looksLikeSecretValue(value)) {
      const location = trail.join(".") || "(root)";
      throw new Error(`Project config must not contain secret-looking values: ${location}`);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      const location = [...trail, key].join(".");
      throw new Error(`Project config must not contain provider secrets: ${location}`);
    }

    assertProjectConfigHasNoSecrets(nested, [...trail, key]);
  }
}
