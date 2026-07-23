import type { Command } from "commander";
import { emitResult } from "../cli/output.js";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { markUsedService } from "../app/library-service.js";
import { serviceError } from "../app/runtime.js";

export function registerMarkUsedCommand(program: Command): void {
  program
    .command("mark-used")
    .description("Record usage for an existing image sha or live occurrence path.")
    .argument("<root>", "project root")
    .option("--sha <sha256>", "content sha256 to mark")
    .option("--path <relPath>", "live occurrence path inside the root")
    .requiredOption("--slot <slot>", "free-text usage slot")
    .requiredOption("--location <location>", "free-text usage location")
    .action(async (root: string, options: Record<string, string>, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean }>();
      try {
        const input: { sha?: string; path?: string; slot: string; location: string } = {
          slot: options.slot ?? "",
          location: options.location ?? ""
        };
        if (options.sha !== undefined) input.sha = options.sha;
        if (options.path !== undefined) input.path = options.path;
        const outcome = await markUsedService(root, input);
        emitResult(outcome.result, { json: globals.json });
        process.exitCode = outcome.exitCode;
      } catch (error) {
        emitResult(serviceError("mark-used", "filesystem_error", error), { json: globals.json });
        process.exitCode = EXIT_CODES.FILESYSTEM_ERROR;
      }
    });
}
