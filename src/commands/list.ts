import type { Command } from "commander";
import { emitResult, errorResult, type CliResult } from "../cli/output.js";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { listService, toPickFilter } from "../app/library-service.js";
import { serviceError } from "../app/runtime.js";
import type { ImageOrientation } from "../domain/analysis-schema.js";

const VALID_ORIENTATIONS: ReadonlySet<string> = new Set<ImageOrientation>([
  "landscape",
  "portrait",
  "square",
  "panorama"
]);

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List indexed live image occurrences.")
    .argument("<root>", "project root")
    .option("--category <category>", "filter by category")
    .option("--orientation <orientation>", "filter by orientation")
    .option("--min-width <px>", "minimum width")
    .option("--min-height <px>", "minimum height")
    .action(async (root: string, options: Record<string, string>, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean }>();
      const minWidthErr = validateIntOption(options.minWidth, "min-width");
      if (minWidthErr) {
        emitResult(minWidthErr, { json: globals.json });
        process.exitCode = EXIT_CODES.INVALID_INPUT;
        return;
      }
      const minHeightErr = validateIntOption(options.minHeight, "min-height");
      if (minHeightErr) {
        emitResult(minHeightErr, { json: globals.json });
        process.exitCode = EXIT_CODES.INVALID_INPUT;
        return;
      }
      const orientationErr = validateEnumOption(
        options.orientation,
        "orientation",
        VALID_ORIENTATIONS,
        "list"
      );
      if (orientationErr) {
        emitResult(orientationErr, { json: globals.json });
        process.exitCode = EXIT_CODES.INVALID_INPUT;
        return;
      }
      const input: Parameters<typeof toPickFilter>[0] = {};
      if (options.category !== undefined) input.category = options.category;
      if (options.orientation !== undefined)
        input.orientation = options.orientation as ImageOrientation;
      const minWidth = intOpt(options.minWidth);
      if (minWidth !== undefined) input.minWidth = minWidth;
      const minHeight = intOpt(options.minHeight);
      if (minHeight !== undefined) input.minHeight = minHeight;
      try {
        const outcome = await listService(root, toPickFilter(input));
        emitResult(outcome.result, { json: globals.json });
        process.exitCode = outcome.exitCode;
      } catch (error) {
        emitResult(serviceError("list", "filesystem_error", error), { json: globals.json });
        process.exitCode = EXIT_CODES.FILESYSTEM_ERROR;
      }
    });
}

function validateIntOption(value: string | undefined, name: string): CliResult | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") {
    return errorResult(
      "list",
      "invalid_input",
      `--${name} must be a positive integer, got: "${value}"`
    );
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || String(parsed) !== trimmed || parsed <= 0) {
    return errorResult(
      "list",
      "invalid_input",
      `--${name} must be a positive integer, got: ${value}`
    );
  }
  return undefined;
}

function validateEnumOption(
  value: string | undefined,
  name: string,
  valid: ReadonlySet<string>,
  command: string
): CliResult | undefined {
  if (value === undefined) return undefined;
  if (!valid.has(value)) {
    return errorResult(
      command,
      "invalid_input",
      `--${name} must be one of: ${[...valid].join(", ")}, got: "${value}"`
    );
  }
  return undefined;
}

/** Exported for focused unit tests of numeric flag validation. */
export function validateListIntOption(
  value: string | undefined,
  name: string
): CliResult | undefined {
  return validateIntOption(value, name);
}

/** Exported for focused unit tests of enum flag validation. */
export function validateListEnumOption(
  value: string | undefined,
  name: string
): CliResult | undefined {
  return validateEnumOption(value, name, VALID_ORIENTATIONS, "list");
}

function intOpt(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number.parseInt(value, 10);
}
