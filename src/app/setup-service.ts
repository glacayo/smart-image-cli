import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import { createReadlinePrompter, isInteractiveTty, type Prompter } from "../cli/prompter.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import { ModelDiscoveryClient } from "../adapters/vision/model-discovery.js";
import {
  annotateModelsWithVisionHints,
  describeVisionHint,
  resolveVisionHint
} from "../adapters/vision/vision-hints.js";
import {
  AuthProviderError,
  EndpointNotFoundProviderError,
  ModelNotFoundProviderError,
  VisionProviderError
} from "../adapters/vision/provider.js";
import { getVisionProviderPreset, type VisionProviderId } from "../adapters/vision/presets.js";
import type { UserConfig } from "../config/user-config.js";
import { readUserConfig, writeUserConfig, type ServiceOutcome } from "./runtime.js";

const PROVIDER_IDS = ["ollama", "openrouter", "gemini"] as const;

export type SetupServiceOptions = {
  provider?: string;
  apiKey?: string;
  model?: string;
  endpoint?: string;
  yes?: boolean;
  userConfigPath?: string;
  fetchImpl?: typeof fetch;
  prompter?: Prompter;
  /** Injected TTY detection for tests. Production uses stdin+stdout isTTY. */
  isTty?: boolean;
  stderr?: NodeJS.WritableStream;
};

/**
 * Guided provider setup: provider → key → connection test → model discovery/selection → persist.
 * Non-TTY invocations never prompt; incomplete flags yield invalid_input (exit 3).
 */
export async function setupService(options: SetupServiceOptions = {}): Promise<ServiceOutcome> {
  const interactive = options.isTty ?? isInteractiveTty(process.stdin, process.stdout);
  const prompter = options.prompter ?? (interactive ? createReadlinePrompter() : undefined);

  try {
    const providerId = await resolveProviderId(options.provider, interactive, prompter);
    if (typeof providerId !== "string") return providerId;

    const apiKey = await resolveApiKey(options.apiKey, interactive, prompter);
    if (typeof apiKey !== "string") return apiKey;

    const preset = getVisionProviderPreset(providerId);
    const endpoint = (options.endpoint ?? preset.endpoint).replace(/\/+$/, "");

    const client = new ModelDiscoveryClient({
      providerId,
      endpoint,
      apiKey,
      redactor: defaultSecretRedactor,
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {})
    });

    let listing: Awaited<ReturnType<ModelDiscoveryClient["listModels"]>>;
    try {
      await client.testConnection();
      listing = await client.listModels();
    } catch (error) {
      return providerFailure(error);
    }

    const warnings: string[] = [];
    let source: "discovery" | "manual" = "discovery";

    let model: string;
    if (listing.supported) {
      const models = annotateModelsWithVisionHints(providerId, listing.models);
      const resolved = await resolveModelFromList({
        models,
        flagModel: options.model,
        interactive,
        prompter,
        yes: options.yes === true
      });
      if (typeof resolved !== "string") return resolved;
      model = resolved;
    } else {
      source = "manual";
      warnings.push(`Model discovery unavailable (${listing.reason}). Enter a model id manually.`);
      const resolved = await resolveManualModel(options.model, interactive, prompter);
      if (typeof resolved !== "string") return resolved;
      model = resolved;
    }

    const vision = resolveVisionHint({
      providerId,
      modelId: model,
      discoveredVision: null
    });
    // Prefer annotated list vision when available.
    const listVision = listing.supported
      ? annotateModelsWithVisionHints(providerId, listing.models).find((m) => m.id === model)
          ?.vision
      : undefined;
    const effectiveVision = listVision !== undefined ? listVision : vision;
    const visionModel = { id: model, vision: effectiveVision ?? null };
    const visionHint = describeVisionHint(visionModel);

    if (effectiveVision !== true) {
      warnings.push(visionHint);
      if (interactive && options.yes !== true) {
        if (prompter === undefined) {
          return incomplete(
            "Interactive setup requires a prompter to confirm non-vision model selection."
          );
        }
        const ok = await prompter.confirm(
          `${visionHint} Continue and save this model anyway?`,
          true
        );
        if (!ok) {
          return {
            result: errorResult(
              "config",
              "invalid_input",
              "Setup cancelled: model selection was not confirmed."
            ),
            exitCode: EXIT_CODES.INVALID_INPUT
          };
        }
      }
    }

    const userConfigPath = options.userConfigPath;
    const current = await readUserConfig(userConfigPath);
    const next = buildNextConfig(current, providerId, {
      provider: providerId,
      endpoint,
      model,
      apiKey
    });
    await writeUserConfig(next, userConfigPath);

    writeHumanLine(
      options.stderr,
      `smart-img config setup: saved provider=${providerId} model=${model} (connection ok)\n`
    );

    return {
      result: successResult("config", {
        action: "setup",
        provider: providerId,
        endpoint: defaultSecretRedactor.mask(endpoint),
        model,
        connectionTest: { ok: true },
        visionHint,
        warnings,
        source
      }),
      exitCode: EXIT_CODES.SUCCESS
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? defaultSecretRedactor.mask(error.message)
        : defaultSecretRedactor.mask(String(error));
    return {
      result: errorResult("config", "invalid_input", message),
      exitCode: EXIT_CODES.INVALID_INPUT
    };
  }
}

async function resolveProviderId(
  flag: string | undefined,
  interactive: boolean,
  prompter: Prompter | undefined
): Promise<VisionProviderId | ServiceOutcome> {
  if (flag !== undefined && flag.length > 0) {
    if (!isVisionProviderId(flag)) {
      return incomplete(`Unknown provider "${flag}". Expected ollama, openrouter, or gemini.`);
    }
    return flag;
  }
  if (!interactive || prompter === undefined) {
    return incomplete("Non-interactive setup requires --provider, --api-key, and --model flags.");
  }
  const selected = await prompter.select("Select AI provider", PROVIDER_IDS);
  if (!isVisionProviderId(selected)) {
    return incomplete(`Unknown provider "${selected}". Expected ollama, openrouter, or gemini.`);
  }
  return selected;
}

async function resolveApiKey(
  flag: string | undefined,
  interactive: boolean,
  prompter: Prompter | undefined
): Promise<string | ServiceOutcome> {
  if (flag !== undefined && flag.length > 0) return flag;
  if (!interactive || prompter === undefined) {
    return incomplete("Non-interactive setup requires --provider, --api-key, and --model flags.");
  }
  const value = await prompter.password("API key");
  if (value.trim().length === 0) {
    return incomplete("API key must not be empty.");
  }
  return value.trim();
}

async function resolveModelFromList(input: {
  models: Array<{ id: string; vision: boolean | null }>;
  flagModel: string | undefined;
  interactive: boolean;
  prompter: Prompter | undefined;
  yes: boolean;
}): Promise<string | ServiceOutcome> {
  if (input.flagModel !== undefined && input.flagModel.length > 0) {
    return input.flagModel;
  }
  if (!input.interactive || input.prompter === undefined) {
    return incomplete("Non-interactive setup requires --provider, --api-key, and --model flags.");
  }

  const recommended = input.models.filter((m) => m.vision === true).map((m) => m.id);
  const others = input.models.filter((m) => m.vision !== true).map((m) => m.id);
  const labeled = [...recommended.map((id) => `${id} (recommended)`), ...others];
  const choices = labeled.length > 0 ? labeled : input.models.map((m) => m.id);
  const selected = await input.prompter.select("Select model", choices);
  // Strip recommendation suffix if present.
  const bare = selected.replace(/\s*\(recommended\)\s*$/i, "").trim();
  return bare;
}

async function resolveManualModel(
  flagModel: string | undefined,
  interactive: boolean,
  prompter: Prompter | undefined
): Promise<string | ServiceOutcome> {
  if (flagModel !== undefined && flagModel.length > 0) return flagModel;
  if (!interactive || prompter === undefined) {
    return incomplete(
      "Non-interactive setup requires --provider, --api-key, and --model flags (discovery unavailable)."
    );
  }
  const value = await prompter.input("Enter model id manually");
  if (value.trim().length === 0) {
    return incomplete("Model id must not be empty.");
  }
  return value.trim();
}

function buildNextConfig(
  current: UserConfig,
  providerId: VisionProviderId,
  provider: {
    provider: VisionProviderId;
    endpoint: string;
    model: string;
    apiKey: string;
  }
): UserConfig {
  return {
    ...current,
    activeProvider: providerId,
    providers: {
      ...current.providers,
      [providerId]: {
        ...current.providers[providerId],
        ...provider
      }
    }
  };
}

function incomplete(message: string): ServiceOutcome {
  return {
    result: errorResult("config", "invalid_input", message),
    exitCode: EXIT_CODES.INVALID_INPUT
  };
}

function isVisionProviderId(value: string): value is VisionProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

function providerFailure(error: unknown): ServiceOutcome {
  const reason =
    error instanceof AuthProviderError
      ? "provider_auth"
      : error instanceof ModelNotFoundProviderError
        ? "model_not_found"
        : error instanceof EndpointNotFoundProviderError
          ? "endpoint_not_found"
          : "provider_error";

  const message =
    error instanceof Error
      ? defaultSecretRedactor.mask(error.message)
      : defaultSecretRedactor.mask(String(error));

  const details: Record<string, unknown> = {
    action: "setup",
    connectionTest: { ok: false, reason }
  };
  if (error instanceof VisionProviderError) {
    details.kind = error.kind;
    details.providerDetails = defaultSecretRedactor.maskValue(error.redactedDetails);
  }
  if (error instanceof ModelNotFoundProviderError) {
    details.model = error.model;
  }
  if (error instanceof EndpointNotFoundProviderError) {
    details.endpoint = defaultSecretRedactor.mask(error.endpoint);
  }

  return {
    result: errorResult("config", reason, message, details),
    exitCode: EXIT_CODES.PROVIDER_ERROR
  };
}

function writeHumanLine(stderr: NodeJS.WritableStream | undefined, line: string): void {
  if (stderr === undefined) return;
  stderr.write(line);
}
