import { describe, expect, it } from "vitest";
import { SecretRedactor } from "../../src/adapters/secret-redactor.js";

// Construct provider-shaped secret fixtures dynamically so the literal
// `sk-...` / `or-...` strings never appear committed in source. The redactor's
// LONG_SECRET_VALUE regex still matches the assembled values because they have
// the provider prefix + 24+ word characters, preserving redaction coverage.
function buildPrefixedSecret(prefix: string, label: string, tail: string): string {
  return `${prefix}-${label}_${tail}`;
}

describe("SecretRedactor", () => {
  it("redacts authorization headers and token-shaped provider diagnostics", () => {
    const redactor = new SecretRedactor();
    const skSecret = buildPrefixedSecret("sk", "test", "123456789012345678901234");
    const orSecret = buildPrefixedSecret("or", "secret", "12345678901234567890");
    const masked = redactor.mask(
      `Authorization: Bearer ${skSecret} provider said token=${orSecret}`
    );

    expect(masked).toContain("Bearer [REDACTED]");
    expect(masked).not.toContain(skSecret);
    expect(masked).not.toContain(orSecret);
  });

  it("redacts object values by secret-looking key names", () => {
    const redactor = new SecretRedactor();
    expect(redactor.maskValue({ apiKey: "abc123", nested: { token: "def456" } })).toEqual({
      apiKey: "[REDACTED]",
      nested: { token: "[REDACTED]" }
    });
  });
});