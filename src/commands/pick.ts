import type { Command } from "commander";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { emitResult, errorResult, type CliResult } from "../cli/output.js";
import {
  pickService,
  type PickDeps,
  type PickOptions,
  type SemanticMode
} from "../app/pick-service.js";
import { buildTextRankerProvider, serviceError } from "../app/runtime.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import { LocalTextRanker } from "../adapters/vision/local-text-ranker.js";
import type { ImageOrientation } from "../domain/analysis-schema.js";
import type { ImageFormat } from "../domain/resize-planner.js";

const VALID_ORIENTATIONS: ReadonlySet<string> = new Set<ImageOrientation>([
  "landscape",
  "portrait",
  "square",
  "panorama"
]);
const VALID_FORMATS: ReadonlySet<string> = new Set<ImageFormat>([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "avif"
]);
const VALID_SEMANTIC_MODES: ReadonlySet<string> = new Set<SemanticMode>(["local", "ai"]);

export function registerPickCommand(program: Command): void {
  program
    .command("pick")
    .description("Select a slot-ready image by category, orientation, and dimensions.")
    .argument("<root>", "project root")
    .option("--category <category>", "single required category")
    .option("--categories <categories>", "comma-separated category alternatives")
    .option("--orientation <orientation>", "required orientation")
    .option("--width <px>", "minimum width")
    .option("--height <px>", "minimum height")
    .option("--format <format>", "output format: jpg, png, webp, or avif")
    .option("--slot <slot>", "free-text usage slot")
    .option("--location <location>", "free-text usage location")
    .option("--allow-reuse", "allow reuse for the same slot and location")
    .option("--query <text>", "free-text intent used to rank eligible candidates")
    .option("--semantic <mode>", "semantic ranking mode: local or ai")
    .option("--top-k <n>", "number of ranking/alternative entries to emit (1..10)")
    .action(async (root: string, options: Record<string, string | boolean>, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean }>();
      const numeric = validatePickNumerics(options);
      if (numeric !== undefined) {
        emitResult(numeric, { json: globals.json });
        process.exitCode = EXIT_CODES.INVALID_INPUT;
        return;
      }
      const enumErr = validatePickEnums(options);
      if (enumErr !== undefined) {
        emitResult(enumErr, { json: globals.json });
        process.exitCode = EXIT_CODES.INVALID_INPUT;
        return;
      }
      try {
        const parsed = parsePickOptions(options);
        if (parsed.query !== undefined && parsed.semantic === undefined) {
          process.stderr.write("img pick: --query provided; defaulted to --semantic local\n");
        }
        let deps: PickDeps;
        try {
          deps = await buildPickDeps(root, parsed);
        } catch (error) {
          emitResult(aiRankingFailed(error), { json: globals.json });
          process.exitCode = EXIT_CODES.PROVIDER_ERROR;
          return;
        }
        const outcome = await pickService(root, parsed, deps);
        emitResult(outcome.result, { json: globals.json });
        process.exitCode = outcome.exitCode;
      } catch (error) {
        emitResult(serviceError("pick", "filesystem_error", error), { json: globals.json });
        process.exitCode = EXIT_CODES.FILESYSTEM_ERROR;
      }
    });
}

function validatePickNumerics(options: Record<string, string | boolean>): CliResult | undefined {
  const widthErr = validateIntOption(options.width, "width");
  if (widthErr) return widthErr;
  const heightErr = validateIntOption(options.height, "height");
  if (heightErr) return heightErr;
  const topKErr = validateTopKOption(options.topK);
  if (topKErr) return topKErr;
  return undefined;
}

function validatePickEnums(options: Record<string, string | boolean>): CliResult | undefined {
  const orientation = str(options.orientation);
  if (orientation !== undefined && !VALID_ORIENTATIONS.has(orientation as ImageOrientation)) {
    return errorResult(
      "pick",
      "invalid_input",
      `--orientation must be one of: ${[...VALID_ORIENTATIONS].join(", ")}, got: "${orientation}"`
    );
  }
  const format = str(options.format);
  if (format !== undefined && !VALID_FORMATS.has(format as ImageFormat)) {
    return errorResult(
      "pick",
      "invalid_input",
      `--format must be one of: ${[...VALID_FORMATS].join(", ")}, got: "${format}"`
    );
  }
  const semantic = str(options.semantic);
  if (semantic !== undefined && !VALID_SEMANTIC_MODES.has(semantic as SemanticMode)) {
    return errorResult(
      "pick",
      "invalid_input",
      `--semantic must be one of: ${[...VALID_SEMANTIC_MODES].join(", ")}, got: "${semantic}"`
    );
  }
  return undefined;
}

/** Exported for focused unit tests of numeric flag validation. */
export function validatePickIntOption(
  value: string | boolean | undefined,
  name: string
): CliResult | undefined {
  return validateIntOption(value, name);
}

/** Exported for focused unit tests of enum flag validation. */
export function validatePickEnumOption(
  option: "orientation" | "format" | "semantic",
  value: string | undefined
): CliResult | undefined {
  if (value === undefined) return undefined;
  const valid =
    option === "orientation"
      ? VALID_ORIENTATIONS
      : option === "format"
        ? VALID_FORMATS
        : VALID_SEMANTIC_MODES;
  const label =
    option === "orientation" ? "orientation" : option === "format" ? "format" : "semantic";
  if (!valid.has(value)) {
    return errorResult(
      "pick",
      "invalid_input",
      `--${label} must be one of: ${[...valid].join(", ")}, got: "${value}"`
    );
  }
  return undefined;
}

export function validatePickTopKOption(value: string | boolean | undefined): CliResult | undefined {
  return validateTopKOption(value);
}

function validateIntOption(
  value: string | boolean | undefined,
  name: string
): CliResult | undefined {
  if (value === undefined || typeof value === "boolean") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") {
    return errorResult(
      "pick",
      "invalid_input",
      `--${name} must be a positive integer, got: "${value}"`
    );
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || String(parsed) !== trimmed || parsed <= 0) {
    return errorResult(
      "pick",
      "invalid_input",
      `--${name} must be a positive integer, got: ${value}`
    );
  }
  return undefined;
}

function validateTopKOption(value: string | boolean | undefined): CliResult | undefined {
  const err = validateIntOption(value, "top-k");
  if (err) return err;
  if (value === undefined || typeof value === "boolean") return undefined;
  const parsed = Number.parseInt(value.trim(), 10);
  if (parsed < 1 || parsed > 10) {
    return errorResult("pick", "invalid_input", `--top-k must be between 1 and 10, got: ${value}`);
  }
  return undefined;
}

export function parsePickOptions(options: Record<string, string | boolean>): PickOptions {
  const parsed: PickOptions = { allowReuse: options.allowReuse === true };
  const category = str(options.category);
  if (category !== undefined) parsed.category = category;
  const categories = str(options.categories)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (categories !== undefined) parsed.categories = categories;
  const orientation = str(options.orientation);
  if (orientation !== undefined)
    parsed.orientation = orientation as NonNullable<PickOptions["orientation"]>;
  const width = intOpt(options.width);
  if (width !== undefined) parsed.width = width;
  const height = intOpt(options.height);
  if (height !== undefined) parsed.height = height;
  const slot = str(options.slot);
  if (slot !== undefined) parsed.slot = slot;
  const location = str(options.location);
  if (location !== undefined) parsed.location = location;
  const format = str(options.format);
  if (format !== undefined) parsed.format = format as NonNullable<PickOptions["format"]>;
  const query = str(options.query)?.trim();
  if (query) parsed.query = query;
  const semantic = str(options.semantic);
  if (semantic !== undefined) parsed.semantic = semantic as SemanticMode;
  const topK = intOpt(options.topK);
  if (topK !== undefined) parsed.topK = topK;
  return parsed;
}

export async function buildPickDeps(root: string, options: PickOptions): Promise<PickDeps> {
  if (options.query === undefined) return {};
  if ((options.semantic ?? "local") === "ai") {
    try {
      return { textRanker: await buildTextRankerProvider(root) };
    } catch (error) {
      throw new Error(
        `AI ranking provider setup failed: ${
          error instanceof Error
            ? defaultSecretRedactor.mask(error.message)
            : defaultSecretRedactor.mask(String(error))
        }`,
        { cause: error }
      );
    }
  }
  return { textRanker: new LocalTextRanker() };
}

function aiRankingFailed(error: unknown): CliResult {
  return errorResult(
    "pick",
    "ai_ranking_failed",
    error instanceof Error
      ? defaultSecretRedactor.mask(error.message)
      : defaultSecretRedactor.mask(String(error))
  );
}
function str(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function intOpt(value: string | boolean | undefined): number | undefined {
  return typeof value === "string" ? Number.parseInt(value, 10) : undefined;
}
