const SECRET_KEY_NAME =
  /(api[-_]?key|authorization|bearer|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|private[-_]?key|auth[-_]?token|bearer[-_]?token|token|secret|password|passwd|pwd|credential)/i;
const LONG_SECRET_VALUE = /\b(?:sk-|or-|AIza|gsk_|ollama_)?[A-Za-z0-9_\-.]{24,}\b/g;
const AUTH_HEADER = /\b(Bearer\s+)[A-Za-z0-9_\-.=]+/gi;
// URL embedded basic-auth credentials: scheme://user:pass@host. Kept for the
// historical `user:pass@` case; the userinfo guard below additionally covers
// `token@` and `:pass@` (any userinfo, not just the colon form).
const URL_CREDENTIALS = /(:\/\/)[^\s/@]+:[^\s/@]+(@)/g;
// Any URL userinfo (user:pass@, token@, :pass@). Captures scheme prefix and the
// trailing `@` so the userinfo portion can be replaced with `[REDACTED]`.
const URL_USERINFO = /(:\/\/)[^\s/?#]+(@)/g;
// Query/fragment parameter tokens: ?api_key=x, &token=y, #access_token=z.
// Covers common secret-bearing param names with hyphen/underscore/case
// variants via the `[_-]?` optional separators and the `i` flag. Encoded
// hyphen/underscore variants (`client%5Fsecret`, `refresh%2Dtoken`, …) are
// handled by the dedicated `URL_ENCODED_PARAM` regex below.
const SECRET_URL_PARAM_NAMES =
  "(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|" +
  "client[_-]?secret|private[_-]?key|auth[_-]?token|bearer[_-]?token|" +
  "token|secret|password|passwd|pwd|credential|key)";
const URL_QUERY_TOKEN = new RegExp(`([?#&])(${SECRET_URL_PARAM_NAMES})(=)[^\\s&#]+`, "gi");
// Percent-encoded query/fragment params whose decoded name is a known secret
// name. Matches `?name=...`, `&name=...`, `#name=...` for any param name and
// then checks the decoded name against SECRET_URL_PARAM_NAMES (case-insensitive).
const URL_ENCODED_PARAM = /([?#&])([^=?#&\s]+)(=)[^&#\s]+/gi;

export class SecretRedactor {
  mask(text: string): string {
    return text
      .replace(AUTH_HEADER, "$1[REDACTED]")
      .replace(URL_CREDENTIALS, "$1[REDACTED]$2")
      .replace(URL_USERINFO, "$1[REDACTED]$2")
      .replace(URL_QUERY_TOKEN, "$1$2$3[REDACTED]")
      .replace(URL_ENCODED_PARAM, (match, prefix: string, name: string, eq: string) => {
        if (!isEncodedSecretParamName(name)) return match;
        return `${prefix}${name}${eq}[REDACTED]`;
      })
      .replace(LONG_SECRET_VALUE, (value) => {
        if (hasKnownSecretPrefix(value)) {
          return maskSecret(value);
        }
        if (looksLikePlainIdentifier(value)) {
          return value;
        }
        return maskSecret(value);
      });
  }

  maskValue(value: unknown): unknown {
    if (typeof value === "string") {
      return this.mask(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.maskValue(item));
    }

    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [
          key,
          SECRET_KEY_NAME.test(key) ? "[REDACTED]" : this.maskValue(nested)
        ])
      );
    }

    return value;
  }
}

export const defaultSecretRedactor = new SecretRedactor();

export function redactErrorMessage(error: unknown, redactor = defaultSecretRedactor): string {
  if (error instanceof Error) {
    return redactor.mask(error.message);
  }
  return redactor.mask(String(error));
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "[REDACTED]";
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Returns true for values that start with a known provider/API token prefix.
 * Such values are always redacted regardless of length or shape.
 */
function hasKnownSecretPrefix(value: string): boolean {
  return /^(sk-|sk_|or-|AIza|gsk_|ollama_)/.test(value);
}

function looksLikePlainIdentifier(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

const ENCODED_SECRET_PARAM_NAME = new RegExp(`^${SECRET_URL_PARAM_NAMES}$`, "i");

/**
 * Returns true when a (possibly percent-encoded) URL query/fragment param
 * name decodes to a known secret-bearing name. Handles encoded hyphen/underscore
 * variants such as `client%5Fsecret`, `refresh%2Dtoken`, `api%2Dkey`, etc.
 */
function isEncodedSecretParamName(rawName: string): boolean {
  if (ENCODED_SECRET_PARAM_NAME.test(rawName)) return true;
  let decoded = rawName;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    return false;
  }
  if (decoded === rawName) return false;
  return ENCODED_SECRET_PARAM_NAME.test(decoded);
}
