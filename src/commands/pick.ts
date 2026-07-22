import type { Command } from "commander";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { emitResult, pendingResult } from "../cli/output.js";

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
    .option("--slot <slot>", "free-text usage slot")
    .option("--location <location>", "free-text usage location")
    .option("--allow-reuse", "allow reuse for the same slot and location")
    .action((root: string, options: Record<string, string | boolean>, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean }>();
      emitResult(pendingResult("pick", { root, options }), { json: globals.json });
      process.exitCode = EXIT_CODES.INVALID_INPUT;
    });
}
