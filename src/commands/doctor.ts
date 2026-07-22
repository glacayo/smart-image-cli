import type { Command } from "commander";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { emitResult, pendingResult } from "../cli/output.js";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check runtime prerequisites and provider readiness.")
    .option("--root <root>", "project root to inspect")
    .action((options: { root?: string }, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean }>();
      emitResult(pendingResult("doctor", { options, node: process.version }), {
        json: globals.json
      });
      process.exitCode = EXIT_CODES.INVALID_INPUT;
    });
}
