import type { Command } from "commander";
import { emitResult } from "../cli/output.js";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { statsService } from "../app/library-service.js";
import { serviceError } from "../app/runtime.js";

export function registerStatsCommand(program: Command): void {
  program
    .command("stats")
    .description("Summarize indexed images, occurrences, thumbnails, and usage records.")
    .argument("<root>", "project root")
    .action(async (root: string, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean }>();
      try {
        const outcome = await statsService(root);
        emitResult(outcome.result, { json: globals.json });
        process.exitCode = outcome.exitCode;
      } catch (error) {
        emitResult(serviceError("stats", "filesystem_error", error), { json: globals.json });
        process.exitCode = EXIT_CODES.FILESYSTEM_ERROR;
      }
    });
}
