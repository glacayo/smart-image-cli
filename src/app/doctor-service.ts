import path from "node:path";
import DatabaseConstructor from "better-sqlite3";
import sharp from "sharp";
import { exiftool } from "exiftool-vendored";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import { readProjectConfig, readUserConfig, type ServiceOutcome } from "./runtime.js";

export type DoctorDeps = {
  /**
   * Optional ExifTool readiness seam. Production omits it (uses the real
   * `exiftool` singleton); tests inject a stub to verify readiness failure
   * behavior without spawning a native ExifTool process.
   */
  exiftoolProbe?: () => Promise<void>;
  /**
   * Optional provider ping seam. Production omits it (live network ping is
   * deferred — see apply-progress); tests inject a stub to verify the ping
   * path surfaces a typed check without real network access.
   */
  pingProvider?: (endpoint: string) => Promise<void>;
  /**
   * Optional user config path seam. Production omits it (uses the default
   * platform user config path); tests inject a controlled path so doctor
   * success/failure contracts are asserted against known config, not the
   * uncontrolled local developer machine config.
   */
  userConfigPath?: string;
};

export async function doctorService(
  options: { root?: string } = {},
  deps: DoctorDeps = {}
): Promise<ServiceOutcome> {
  const root = path.resolve(options.root ?? process.cwd());
  const checks: Array<{
    name: string;
    ok: boolean;
    message?: string;
    details?: unknown;
    deferred?: boolean;
  }> = [];
  checks.push({
    name: "node",
    ok: Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10) >= 22,
    message: process.version
  });
  try {
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
      .png()
      .toBuffer();
    checks.push({ name: "sharp", ok: true });
  } catch (error) {
    checks.push({ name: "sharp", ok: false, message: message(error) });
  }
  try {
    const db = new DatabaseConstructor(":memory:");
    db.close();
    checks.push({ name: "sqlite", ok: true });
  } catch (error) {
    checks.push({ name: "sqlite", ok: false, message: message(error) });
  }
  // ExifTool readiness: verify the native ExifTool process can be spawned and
  // responds with a version. Tests inject `deps.exiftoolProbe` to avoid
  // spawning the real process.
  try {
    const probe = deps.exiftoolProbe ?? probeExiftool;
    await probe();
    checks.push({ name: "exiftool", ok: true });
  } catch (error) {
    checks.push({ name: "exiftool", ok: false, message: message(error) });
  }
  try {
    // Mask project config details defensively before output. Validation
    // (`assertProjectConfigHasNoSecrets`) already rejects secret-shaped values
    // at parse time, but defense-in-depth ensures a future validation gap (e.g.
    // a fragment token endpoint that slipped past the regex) never leaks raw
    // secrets through `doctor` output.
    checks.push({
      name: "project-config",
      ok: true,
      details: defaultSecretRedactor.maskValue(await readProjectConfig(root))
    });
  } catch (error) {
    checks.push({ name: "project-config", ok: false, message: message(error) });
  }
  let providerPingDeferred = false;
  try {
    const cfg = await readUserConfig(deps.userConfigPath);
    const active = cfg.providers[cfg.activeProvider];
    checks.push({
      name: "provider-config",
      ok: active?.apiKey !== undefined,
      details: defaultSecretRedactor.maskValue({
        activeProvider: cfg.activeProvider,
        provider: active
      })
    });
    // Provider reachability ping. Live network ping is deferred to a later
    // slice (see apply-progress); when a ping seam is provided (tests) or
    // when the active endpoint is reachable, report ok=true. Without a seam
    // and without network access this check is explicitly marked `deferred`
    // and `ok=false` so `doctor` does not falsely claim reachability it never
    // verified, and the overall status does not claim full readiness.
    if (active?.apiKey !== undefined) {
      const endpoint =
        active.endpoint ??
        `https://${cfg.activeProvider}.example.com`; /* placeholder, not pinged without seam */
      // Mask the endpoint before including it in check details so URL
      // basic-auth credentials (https://user:pass@host) and short query
      // tokens (?api_key=x) never leak through `doctor` output. The live
      // ping receives the raw endpoint; only the reported details are masked.
      const maskedEndpoint =
        typeof endpoint === "string" ? defaultSecretRedactor.mask(endpoint) : endpoint;
      const ping = deps.pingProvider;
      if (ping !== undefined) {
        try {
          await ping(endpoint);
          checks.push({ name: "provider-ping", ok: true, details: { endpoint: maskedEndpoint } });
        } catch (error) {
          checks.push({
            name: "provider-ping",
            ok: false,
            message: message(error),
            details: { endpoint: maskedEndpoint }
          });
        }
      } else {
        // No live ping performed in this slice; documented as deferred and
        // NOT ok, so the overall status cannot silently claim full readiness.
        providerPingDeferred = true;
        checks.push({
          name: "provider-ping",
          ok: false,
          deferred: true,
          message: "deferred: live provider ping is not implemented in this slice",
          details: { endpoint: maskedEndpoint, deferred: true }
        });
      }
    }
  } catch (error) {
    checks.push({ name: "provider-config", ok: false, message: message(error) });
  }
  // A deferred or failed check means we cannot honestly report full readiness.
  const ok = checks.every((check) => check.ok) && !providerPingDeferred;
  const result = ok
    ? successResult("doctor", { checks })
    : errorResult(
        "doctor",
        providerPingDeferred ? "doctor_not_verified" : "doctor_failed",
        providerPingDeferred
          ? "doctor checks passed but provider reachability was not verified"
          : "one or more doctor checks failed"
      );
  result.ok = ok;
  result.status = ok ? "success" : "failed";
  result.details = { checks };
  if (!ok) result.reason = providerPingDeferred ? "doctor_not_verified" : "doctor_failed";
  return { result, exitCode: ok ? EXIT_CODES.SUCCESS : EXIT_CODES.FILESYSTEM_ERROR };
}

/**
 * Default ExifTool readiness probe. Calls the real `exiftool.version()` which
 * spawns the native ExifTool process and resolves with its version string. If
 * the binary cannot be spawned (missing, permission denied, etc.) this rejects
 * with a typed error that `doctor` surfaces as `exiftool: ok=false`.
 */
async function probeExiftool(): Promise<void> {
  await exiftool.version();
}

function message(error: unknown): string {
  return defaultSecretRedactor.mask(error instanceof Error ? error.message : String(error));
}
