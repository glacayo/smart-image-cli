import path from "node:path";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import {
  emptyProjectConfig,
  parseProjectConfig,
  type ProjectConfig
} from "../config/project-config.js";
import {
  readProjectConfig,
  readUserConfig,
  writeProjectConfig,
  writeUserConfig,
  isNodeError,
  type ServiceOutcome
} from "./runtime.js";

const SECRET_KEY_NAME = /(api[-_]?key|authorization|bearer|token|secret|password|credential)/i;

/**
 * Masks a value retrieved by a dotted key path. When the final key segment
 * looks like a secret-named field (apiKey, token, secret, password, credential,
 * authorization, bearer), the value is redacted to "[REDACTED]" regardless of
 * its shape or length — a short non-token-shaped API key must not leak through
 * `config get providers.<id>.apiKey`. Non-secret keys fall back to the standard
 * value-shape redactor.
 */
function maskByContext(dottedKey: string, value: unknown): unknown {
  const lastSegment = dottedKey.split(".").at(-1) ?? "";
  if (SECRET_KEY_NAME.test(lastSegment)) {
    return "[REDACTED]";
  }
  return defaultSecretRedactor.maskValue(value);
}

/**
 * Reads project config, mapping a genuinely missing config file (ENOENT) to
 * an empty config and surfacing any other failure (StorageRootGuardError,
 * path escape, parse error) as a structured `invalid_input` outcome (exit 3)
 * with a redacted message. This prevents guard/path failures from being
 * silently hidden as "no project config" by `config --project list/get/set`.
 */
async function safeReadProjectConfig(
  root: string
): Promise<{ config: ProjectConfig } | { error: ServiceOutcome }> {
  try {
    return { config: await readProjectConfig(root) };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { config: emptyProjectConfig() };
    }
    const msg = defaultSecretRedactor.mask(error instanceof Error ? error.message : String(error));
    return {
      error: {
        result: errorResult("config", "invalid_input", msg),
        exitCode: EXIT_CODES.INVALID_INPUT
      }
    };
  }
}

export async function configService(
  action = "list",
  key: string | undefined,
  value: string | undefined,
  options: { project?: boolean; root?: string; userConfigPath?: string } = {}
): Promise<ServiceOutcome> {
  const root = path.resolve(options.root ?? process.cwd());
  if (options.project === true) {
    // Missing project config (ENOENT) maps to an empty config and is a normal
    // "no project config" state. Any OTHER failure — especially a
    // StorageRootGuardError indicating the config path escapes root via a
    // symlink/junction/reparse point — MUST surface as a structured failure
    // (exit non-zero, redacted message) instead of being silently swallowed
    // as an empty config.
    const readOutcome = await safeReadProjectConfig(root);
    if ("error" in readOutcome) {
      return readOutcome.error;
    }
    const current: ProjectConfig = readOutcome.config;
    if (action === "list")
      return {
        result: successResult("config", {
          scope: "project",
          config: defaultSecretRedactor.maskValue(current)
        }),
        exitCode: EXIT_CODES.SUCCESS
      };
    if (action === "get" && key) {
      try {
        return {
          result: successResult("config", {
            key,
            value: maskByContext(key, getPath(current, key))
          }),
          exitCode: EXIT_CODES.SUCCESS
        };
      } catch (error) {
        return invalidKey(error);
      }
    }
    if (action === "set" && key && value !== undefined) {
      try {
        const next = setPath(
          structuredClone(current) as Record<string, unknown>,
          key,
          parseValue(value)
        );
        await writeProjectConfig(root, parseProjectConfig(next));
        return {
          result: successResult("config", {
            scope: "project",
            key,
            value: maskByContext(key, getPath(next, key))
          }),
          exitCode: EXIT_CODES.SUCCESS
        };
      } catch (error) {
        return invalidKey(error);
      }
    }
    return invalid();
  }

  const userConfigPath = options.userConfigPath;
  const current = await readUserConfig(userConfigPath);
  if (action === "list")
    return {
      result: successResult("config", {
        scope: "user",
        config: defaultSecretRedactor.maskValue(current)
      }),
      exitCode: EXIT_CODES.SUCCESS
    };
  if (action === "get" && key) {
    try {
      return {
        result: successResult("config", {
          key,
          value: maskByContext(key, getPath(current, key))
        }),
        exitCode: EXIT_CODES.SUCCESS
      };
    } catch (error) {
      return invalidKey(error);
    }
  }
  if (action === "set" && key && value !== undefined) {
    try {
      const next = setPath(
        structuredClone(current) as Record<string, unknown>,
        key,
        parseValue(value)
      );
      await writeUserConfig(next as never, userConfigPath);
      return {
        result: successResult("config", {
          scope: "user",
          key,
          value: maskByContext(key, getPath(next, key))
        }),
        exitCode: EXIT_CODES.SUCCESS
      };
    } catch (error) {
      return invalidKey(error);
    }
  }
  return invalid();
}

function invalidKey(error: unknown): ServiceOutcome {
  if (error instanceof ConfigKeyError) {
    return {
      result: errorResult("config", "invalid_input", error.message),
      exitCode: EXIT_CODES.INVALID_INPUT
    };
  }
  // Project-config secret rejection and Zod schema validation produce plain
  // Error / ZodError instances during `set`. These are user-input validation
  // failures, not internal faults, so surface them as structured invalid_input
  // (exit 3) with the redacted message rather than crashing the process.
  if (error instanceof Error) {
    const msg = defaultSecretRedactor.mask(error.message);
    if (
      msg.includes("Project config must not contain") ||
      msg.includes("must not contain") ||
      isZodError(error)
    ) {
      return {
        result: errorResult("config", "invalid_input", msg),
        exitCode: EXIT_CODES.INVALID_INPUT
      };
    }
  }
  throw error;
}

function isZodError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name: string }).name === "ZodError"
  );
}

function invalid(): ServiceOutcome {
  return {
    result: errorResult(
      "config",
      "invalid_input",
      "Expected config list|get <key>|set <key> <value>"
    ),
    exitCode: EXIT_CODES.INVALID_INPUT
  };
}
function parseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function getPath(obj: unknown, dotted: string): unknown {
  assertSafeDottedKey(dotted);
  return dotted
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined,
      obj
    );
}
function setPath(
  obj: Record<string, unknown>,
  dotted: string,
  value: unknown
): Record<string, unknown> {
  assertSafeDottedKey(dotted);
  const parts = dotted.split(".");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    const next = cur[part];
    if (next === undefined || next === null || typeof next !== "object" || Array.isArray(next))
      cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts.at(-1)!] = value;
  return obj;
}

/**
 * Rejects dotted configuration keys that could enable prototype pollution or
 * traverse unsafe paths. Blocks `__proto__`, `constructor`, `prototype`,
 * empty segments (e.g. `a..b`, `.x`, `x.`), and segments that are not plain
 * property names.
 */
const FORBIDDEN_PROTO_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function assertSafeDottedKey(dotted: string): void {
  if (dotted.length === 0) {
    throw new ConfigKeyError("Configuration key must not be empty");
  }
  const parts = dotted.split(".");
  for (const part of parts) {
    if (part.length === 0) {
      throw new ConfigKeyError(`Configuration key has an empty segment: ${dotted}`);
    }
    if (FORBIDDEN_PROTO_SEGMENTS.has(part)) {
      throw new ConfigKeyError(`Configuration key uses a forbidden segment: ${part}`);
    }
  }
}

export class ConfigKeyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigKeyError";
  }
}
