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

  it("redacts known-prefix hyphenated provider tokens (sk-proj-…)", () => {
    const redactor = new SecretRedactor();
    // Assembled so the literal provider token shape is not committed verbatim.
    const skProj = buildPrefixedSecret("sk-proj", "abcdef", "ghijklmnopqrstuvwxyz123456");
    const masked = redactor.mask(`provider_key=${skProj}`);
    expect(masked).not.toContain(skProj);
    // The redacted form keeps a short prefix/suffix and masks the middle.
    expect(masked).toContain("sk-p");
  });

  it("redacts or- prefixed tokens", () => {
    const redactor = new SecretRedactor();
    const orToken = buildPrefixedSecret("or-v1", "abcdef", "ghijklmnopqrstuvwxyz123456");
    const masked = redactor.mask(`key=${orToken}`);
    expect(masked).not.toContain(orToken);
  });

  it("does not redact plain sha256 hashes", () => {
    const redactor = new SecretRedactor();
    const hash = "a".repeat(64);
    const masked = redactor.mask(`sha256=${hash}`);
    expect(masked).toContain(hash);
  });

  it("redacts URL basic-auth credentials", () => {
    const redactor = new SecretRedactor();
    const masked = redactor.mask("https://user:pass@host.com");
    expect(masked).not.toContain("user:pass");
    expect(masked).toContain("[REDACTED]");
    expect(masked).toContain("host.com");
  });

  it("redacts short query-param tokens in URLs", () => {
    const redactor = new SecretRedactor();
    const masked = redactor.mask("https://host.com?api_key=x");
    expect(masked).not.toContain("api_key=x");
    expect(masked).toContain("[REDACTED]");
  });

  it("redacts short fragment tokens in URLs", () => {
    const redactor = new SecretRedactor();
    const masked = redactor.mask("https://host.com#token=y");
    expect(masked).not.toContain("token=y");
    expect(masked).toContain("[REDACTED]");
  });

  it("redacts refresh_token query params in URLs", () => {
    const redactor = new SecretRedactor();
    const masked = redactor.mask("https://host.com?refresh_token=secretvalue");
    expect(masked).not.toContain("secretvalue");
    expect(masked).toContain("[REDACTED]");
  });

  it("redacts id_token fragment params in URLs", () => {
    const redactor = new SecretRedactor();
    const masked = redactor.mask("https://host.com#id_token=secretvalue");
    expect(masked).not.toContain("secretvalue");
    expect(masked).toContain("[REDACTED]");
  });

  it("redacts client_secret params in URLs", () => {
    const redactor = new SecretRedactor();
    const masked = redactor.mask("https://host.com?client_secret=secretvalue");
    expect(masked).not.toContain("secretvalue");
    expect(masked).toContain("[REDACTED]");
  });

  it("redacts key params in URLs", () => {
    const redactor = new SecretRedactor();
    const masked = redactor.mask("https://host.com?key=secretvalue");
    expect(masked).not.toContain("secretvalue");
    expect(masked).toContain("[REDACTED]");
  });

  it("redacts hyphenated and upper-case variants of secret param names", () => {
    const redactor = new SecretRedactor();
    const masked = redactor.mask("https://host.com?API-KEY=secretvalue&Refresh-Token=xyz");
    expect(masked).not.toContain("secretvalue");
    expect(masked).not.toContain("xyz");
    expect(masked).toContain("[REDACTED]");
  });

  it("redacts object values by refresh_token/client_secret key names", () => {
    const redactor = new SecretRedactor();
    expect(redactor.maskValue({ refresh_token: "abc", nested: { client_secret: "def" } })).toEqual({
      refresh_token: "[REDACTED]",
      nested: { client_secret: "[REDACTED]" }
    });
  });

  it("redacts URL credentials in object endpoint values via maskValue", () => {
    const redactor = new SecretRedactor();
    const masked = redactor.maskValue({
      endpoint: "https://user:pass@host.com"
    }) as { endpoint: string };
    expect(masked.endpoint).not.toContain("user:pass");
    expect(masked.endpoint).toContain("[REDACTED]");
  });

  it("redacts any URL userinfo, including token@ and :pass@", () => {
    const redactor = new SecretRedactor();
    const tokenMasked = redactor.mask("https://token@host.com");
    expect(tokenMasked).not.toContain("token@");
    expect(tokenMasked).toContain("[REDACTED]");
    expect(tokenMasked).toContain("host.com");

    const passOnlyMasked = redactor.mask("https://:pass@host.com");
    expect(passOnlyMasked).not.toContain(":pass@");
    expect(passOnlyMasked).toContain("[REDACTED]");
    expect(passOnlyMasked).toContain("host.com");

    const userPassMasked = redactor.mask("https://user:pass@host.com");
    expect(userPassMasked).not.toContain("user:pass");
    expect(userPassMasked).toContain("[REDACTED]");
  });

  it("redacts encoded query-param names that decode to secret names", () => {
    const redactor = new SecretRedactor();
    const cases = [
      "https://host.com?client%5Fsecret=secretvalue",
      "https://host.com?refresh%2Dtoken=secretvalue",
      "https://host.com?api%2Dkey=secretvalue",
      "https://host.com?access%5Ftoken=secretvalue",
      "https://host.com#id%2Dtoken=secretvalue"
    ];
    for (const url of cases) {
      const masked = redactor.mask(url);
      expect(masked, `for url ${url}`).not.toContain("secretvalue");
      expect(masked, `for url ${url}`).toContain("[REDACTED]");
    }
  });

  it("does not redact non-secret encoded query params", () => {
    const redactor = new SecretRedactor();
    const masked = redactor.mask("https://host.com?foo%2Dbar=plainvalue");
    expect(masked).toContain("plainvalue");
  });
});
