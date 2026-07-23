const SECRET_KEY_NAME = /(api[-_]?key|authorization|bearer|token|secret|password|credential)/i;
const LONG_SECRET_VALUE = /\b(?:sk-|or-|AIza|gsk_|ollama_)?[A-Za-z0-9_\-.]{24,}\b/g;
const AUTH_HEADER = /\b(Bearer\s+)[A-Za-z0-9_\-.=]+/gi;

export class SecretRedactor {
  mask(text: string): string {
    return text.replace(AUTH_HEADER, "$1[REDACTED]").replace(LONG_SECRET_VALUE, (value) => {
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

function looksLikePlainIdentifier(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value) || /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(value);
}
