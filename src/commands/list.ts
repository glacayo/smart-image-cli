import type { Command } from "commander";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { emitResult, pendingResult } from "../cli/output.js";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List indexed live image occurrences.")
    .argument("<root>", "project root")
    .option("--category <category>", "filter by category")
    .option("--orientation <orientation>", "filter by orientation")
    .option("--min-width <px>", "minimum width")
    .option("--min-height <px>", "minimum height")
    .action((root: string, options: Record<string, string>, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean }>();
      emitResult(pendingResult("list", { root, options }), { json: globals.json });
      process.exitCode = EXIT_CODES.INVALID_INPUT;
    });
}
