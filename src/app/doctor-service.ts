import path from "node:path";
import DatabaseConstructor from "better-sqlite3";
import sharp from "sharp";
import { exiftool } from "exiftool-vendored";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import { probeOllamaChat, resolveOllamaApiEndpoint } from "../adapters/vision/ollama-cloud.js";
import { ModelDiscoveryClient } from "../adapters/vision/model-discovery.js";
import { postChatCompletion } from "../adapters/vision/openai-compat-transport.js";
import { getVisionProviderPreset, type VisionProviderId } from "../adapters/vision/presets.js";
import {
  AuthProviderError,
  EndpointNotFoundProviderError,
  VisionProviderError
} from "../adapters/vision/provider.js";
import { readProjectConfig, readUserConfig, type ServiceOutcome } from "./runtime.js";

export type DoctorDeps = {
  /**
   * Optional ExifTool readiness seam. Production omits it (uses the real
   * `exiftool` singleton); tests inject a stub to verify readiness failure
   * behavior without spawning a native ExifTool process.
   */
  exiftoolProbe?: () => Promise<void>;
  /**
   * Optional fetch seam for provider endpoint/model reachability via
   * `ModelDiscoveryClient`. Production uses global `fetch`; tests inject a
   * stub to avoid live network access.
   */
  fetchImpl?: typeof fetch;
  /**
   * Optional user config path seam. Production omits it (uses the default
   * platform user config path); tests inject a controlled path so doctor
   * success/failure contracts are asserted against known config, not the
   * uncontrolled local developer machine config.
   */
  userConfigPath?: string;
};

type DoctorCheck = {
  name: string;
  ok: boolean;
  message?: string;
  details?: unknown;
  deferred?: boolean;
};

export async function doctorService(
  options: { root?: string } = {},
  deps: DoctorDeps = {}
): Promise<ServiceOutcome> {
  const root = path.resolve(options.root ?? process.cwd());
  const checks: DoctorCheck[] = [];
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
  try {
    const cfg = await readUserConfig(deps.userConfigPath);
    const activeProvider = cfg.activeProvider as VisionProviderId;
    const active = cfg.providers[activeProvider];
    const preset = getVisionProviderPreset(activeProvider);
    const endpoint = (active?.endpoint ?? preset.endpoint).replace(/\/+$/, "");
    const model = active?.model ?? preset.defaultModel;
    const maskedEndpoint = defaultSecretRedactor.mask(endpoint);

    checks.push({
      name: "provider-config",
      ok: active?.apiKey !== undefined,
      details: defaultSecretRedactor.maskValue({
        activeProvider,
        provider: {
          provider: active?.provider ?? activeProvider,
          endpoint,
          model,
          ...(active?.apiKey !== undefined ? { apiKey: active.apiKey } : {})
        }
      })
    });

    // Real endpoint + configured-model reachability via metadata-only discovery.
    if (active?.apiKey !== undefined) {
      const client = new ModelDiscoveryClient({
        providerId: activeProvider,
        endpoint,
        apiKey: active.apiKey,
        redactor: defaultSecretRedactor,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {})
      });

      let endpointOk = false;
      let modelOk = false;
      try {
        await client.testConnection();
        endpointOk = true;
        checks.push({
          name: "provider-endpoint",
          ok: true,
          details: { endpoint: maskedEndpoint }
        });
      } catch (error) {
        checks.push({
          name: "provider-endpoint",
          ok: false,
          message: providerEndpointMessage(error),
          details: {
            endpoint: maskedEndpoint,
            ...(error instanceof VisionProviderError
              ? {
                  kind: error.kind,
                  providerDetails: defaultSecretRedactor.maskValue(error.redactedDetails)
                }
              : {})
          }
        });
      }

      if (endpointOk) {
        try {
          const listing = await client.listModels();
          if (!listing.supported) {
            checks.push({
              name: "provider-model",
              ok: false,
              message: `Could not verify model "${model}" (${listing.reason}). Run \`smart-img config setup\` to choose an available model.`,
              details: { endpoint: maskedEndpoint, model, source: "unavailable" }
            });
          } else {
            const ids = new Set(listing.models.map((m) => m.id));
            if (ids.has(model)) {
              modelOk = true;
              checks.push({
                name: "provider-model",
                ok: true,
                details: { endpoint: maskedEndpoint, model, source: "discovery" }
              });
            } else {
              checks.push({
                name: "provider-model",
                ok: false,
                message: `Configured model "${model}" is not available from the provider. Run \`smart-img config setup\` to choose an available model.`,
                details: { endpoint: maskedEndpoint, model, source: "discovery" }
              });
            }
          }
        } catch (error) {
          checks.push({
            name: "provider-model",
            ok: false,
            message: `${message(error)}. Run \`smart-img config setup\` to choose an available model.`,
            details: { endpoint: maskedEndpoint, model }
          });
        }
      } else {
        checks.push({
          name: "provider-model",
          ok: false,
          message: `Skipped model reachability because the provider endpoint check failed. Run \`smart-img config setup\` after fixing endpoint/API key issues.`,
          details: { endpoint: maskedEndpoint, model }
        });
      }

      if (endpointOk && modelOk) {
        try {
          await probeProviderChatCompletion({
            providerId: activeProvider,
            endpoint,
            apiKey: active.apiKey,
            model,
            ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {})
          });
          checks.push({
            name: "provider-chat",
            ok: true,
            details: providerChatDetails(activeProvider, endpoint, maskedEndpoint, model)
          });
        } catch (error) {
          checks.push({
            name: "provider-chat",
            ok: false,
            message: providerChatMessage(error),
            details: {
              ...providerChatDetails(activeProvider, endpoint, maskedEndpoint, model),
              model,
              ...(error instanceof VisionProviderError
                ? {
                    kind: error.kind,
                    providerDetails: defaultSecretRedactor.maskValue(error.redactedDetails)
                  }
                : {})
            }
          });
        }
      }
    }
  } catch (error) {
    checks.push({ name: "provider-config", ok: false, message: message(error) });
  }

  const ok = checks.every((check) => check.ok);
  const result = ok
    ? successResult("doctor", { checks })
    : errorResult("doctor", "doctor_failed", "one or more doctor checks failed");
  result.ok = ok;
  result.status = ok ? "success" : "failed";
  result.details = { checks };
  if (!ok) result.reason = "doctor_failed";
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

async function probeProviderChatCompletion(options: {
  providerId: VisionProviderId;
  endpoint: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (options.providerId === "ollama") {
    await probeOllamaChat({
      endpoint: options.endpoint,
      apiKey: options.apiKey,
      model: options.model,
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      redactor: defaultSecretRedactor
    });
    return;
  }

  await postChatCompletion({
    endpoint: options.endpoint,
    apiKey: options.apiKey,
    model: options.model,
    body: {
      model: options.model,
      max_tokens: 1,
      messages: [{ role: "user", content: "Reply with OK." }]
    },
    timeoutMs: 15_000,
    fetchImpl: options.fetchImpl ?? fetch,
    redactor: defaultSecretRedactor,
    rateLimitMessage: "Provider chat completions rate limit",
    httpErrorMessage: (status) =>
      `Provider chat completions returned HTTP ${status}. The configured provider must support OpenAI-compatible POST /chat/completions before analyze can run.`,
    nonJsonMessage: "Provider chat completions returned non-JSON response",
    requestFailedMessage: "Provider chat completions request failed",
    authErrorMessage:
      "Provider chat completions authentication failed. The API key can list models but cannot run inference; verify chat/inference permissions or run `smart-img config setup`."
  });
}

function providerChatDetails(
  providerId: VisionProviderId,
  endpoint: string,
  maskedEndpoint: string,
  model: string
): { endpoint: string; model: string; route: string } {
  if (providerId === "ollama") {
    return {
      endpoint: defaultSecretRedactor.mask(resolveOllamaApiEndpoint(endpoint)),
      model,
      route: "POST /api/chat"
    };
  }
  return { endpoint: maskedEndpoint, model, route: "POST /chat/completions" };
}

function providerEndpointMessage(error: unknown): string {
  if (error instanceof AuthProviderError) {
    return message(error);
  }
  if (error instanceof EndpointNotFoundProviderError) {
    return message(error);
  }
  return message(error);
}

function providerChatMessage(error: unknown): string {
  const base = message(error).replace(/[.\s]+$/, "");
  return (
    `${base}. ` +
    "`doctor` now checks the same chat completions route used by `analyze`, not only metadata model listing."
  );
}

function message(error: unknown): string {
  return defaultSecretRedactor.mask(error instanceof Error ? error.message : String(error));
}
