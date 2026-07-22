import type { Command } from "commander";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { emitResult, pendingResult } from "../cli/output.js";

export function registerStatsCommand(program: Command): void {
  program
    .command("stats")
    .description("Summarize indexed images, occurrences, thumbnails, and usage records.")
    .argument("<root>", "project root")
    .action((root: string, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean }>();
      emitResult(pendingResult("stats", { root }), { json: globals.json });
      process.exitCode = EXIT_CODES.INVALID_INPUT;
    });
}
