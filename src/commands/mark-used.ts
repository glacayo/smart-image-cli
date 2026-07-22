import type { Command } from "commander";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { emitResult, pendingResult } from "../cli/output.js";

export function registerMarkUsedCommand(program: Command): void {
  program
    .command("mark-used")
    .description("Record usage for an existing image sha or live occurrence path.")
    .argument("<root>", "project root")
    .option("--sha <sha256>", "content sha256 to mark")
    .option("--path <relPath>", "live occurrence path inside the root")
    .requiredOption("--slot <slot>", "free-text usage slot")
    .requiredOption("--location <location>", "free-text usage location")
    .action((root: string, options: Record<string, string>, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean }>();
      emitResult(pendingResult("mark-used", { root, options }), { json: globals.json });
      process.exitCode = EXIT_CODES.INVALID_INPUT;
    });
}
