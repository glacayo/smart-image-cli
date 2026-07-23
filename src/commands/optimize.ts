import type { Command } from "commander";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { emitResult, errorResult, type CliResult } from "../cli/output.js";
import { optimizeService, type OptimizeOptions } from "../app/optimize-service.js";
import { serviceError } from "../app/runtime.js";
import type { ImageFormat } from "../domain/resize-planner.js";

const VALID_FORMATS: ReadonlySet<string> = new Set<ImageFormat>([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "avif"
]);

export function registerOptimizeCommand(program: Command): void {
  program
    .command("optimize")
    .description("Produce a web-ready asset without upscaling or leaking metadata.")
    .argument("<root>", "project root")
    .argument("<source>", "source image path inside the root")
    .option("--format <format>", "output format: jpg, png, webp, or avif")
    .option("--width <px>", "requested width in pixels")
    .option("--height <px>", "requested height in pixels")
    .option("--max-width <px>", "maximum width in pixels")
    .option("--max-height <px>", "maximum height in pixels")
    .option("--keep-metadata", "preserve metadata by explicit opt-in")
    .action(
      (
        root: string,
        source: string,
        options: Record<string, string | boolean>,
        command: Command
      ) => {
        return (async () => {
          const globals = command.optsWithGlobals<{ json?: boolean }>();
          const numeric = validateOptimizeNumerics(options);
          if (numeric !== undefined) {
            emitResult(numeric, { json: globals.json });
            process.exitCode = EXIT_CODES.INVALID_INPUT;
            return;
          }
          const formatErr = validateOptimizeFormat(options.format);
          if (formatErr !== undefined) {
            emitResult(formatErr, { json: globals.json });
            process.exitCode = EXIT_CODES.INVALID_INPUT;
            return;
          }
          try {
            const outcome = await optimizeService(root, source, parseOptimizeOptions(options));
            emitResult(outcome.result, { json: globals.json });
            process.exitCode = outcome.exitCode;
          } catch (error) {
            emitResult(serviceError("optimize", "filesystem_error", error), {
              json: globals.json
            });
            process.exitCode = EXIT_CODES.FILESYSTEM_ERROR;
          }
        })();
      }
    );
}

function validateOptimizeNumerics(
  options: Record<string, string | boolean>
): CliResult | undefined {
  for (const name of ["width", "height", "maxWidth", "maxHeight"] as const) {
    const flagName = name === "maxWidth" ? "max-width" : name === "maxHeight" ? "max-height" : name;
    const err = validateIntOption(options[name], flagName);
    if (err) return err;
  }
  return undefined;
}

function validateOptimizeFormat(value: string | boolean | undefined): CliResult | undefined {
  if (value === undefined || typeof value === "boolean") return undefined;
  if (!VALID_FORMATS.has(value as ImageFormat)) {
    return errorResult(
      "optimize",
      "invalid_input",
      `--format must be one of: ${[...VALID_FORMATS].join(", ")}, got: "${value}"`
    );
  }
  return undefined;
}

/** Exported for focused unit tests of numeric flag validation. */
export function validateOptimizeIntOption(
  value: string | boolean | undefined,
  name: string
): CliResult | undefined {
  return validateIntOption(value, name);
}

/** Exported for focused unit tests of format enum flag validation. */
export function validateOptimizeFormatOption(
  value: string | boolean | undefined
): CliResult | undefined {
  return validateOptimizeFormat(value);
}

function validateIntOption(
  value: string | boolean | undefined,
  name: string
): CliResult | undefined {
  if (value === undefined || typeof value === "boolean") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") {
    return errorResult(
      "optimize",
      "invalid_input",
      `--${name} must be a positive integer, got: "${value}"`
    );
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || String(parsed) !== trimmed || parsed <= 0) {
    return errorResult(
      "optimize",
      "invalid_input",
      `--${name} must be a positive integer, got: ${value}`
    );
  }
  return undefined;
}

function parseOptimizeOptions(options: Record<string, string | boolean>): OptimizeOptions {
  const parsed: OptimizeOptions = { keepMetadata: options.keepMetadata === true };
  if (typeof options.format === "string")
    parsed.format = options.format as NonNullable<OptimizeOptions["format"]>;
  assignNumber(parsed, "width", intOpt(options.width));
  assignNumber(parsed, "height", intOpt(options.height));
  assignNumber(parsed, "maxWidth", intOpt(options.maxWidth));
  assignNumber(parsed, "maxHeight", intOpt(options.maxHeight));
  return parsed;
}
function intOpt(value: string | boolean | undefined): number | undefined {
  return typeof value === "string" ? Number.parseInt(value, 10) : undefined;
}
function assignNumber(
  target: OptimizeOptions,
  key: "width" | "height" | "maxWidth" | "maxHeight",
  value: number | undefined
): void {
  if (value !== undefined) target[key] = value;
}
