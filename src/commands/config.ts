import type { Command } from "commander";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { emitResult, pendingResult } from "../cli/output.js";

export function registerConfigCommand(program: Command): void {
  program
    .command("config")
    .description("Inspect or update user and project configuration.")
    .argument("[action]", "list, get, or set")
    .argument("[key]", "configuration key")
    .argument("[value]", "configuration value for set")
    .option("--project", "target project-local config instead of per-user config")
    .action(
      (
        action: string | undefined,
        key: string | undefined,
        value: string | undefined,
        options: { project?: boolean },
        command: Command
      ) => {
        const globals = command.optsWithGlobals<{ json?: boolean }>();
        emitResult(pendingResult("config", { action, key, value, options }), {
          json: globals.json
        });
        process.exitCode = EXIT_CODES.INVALID_INPUT;
      }
    );
}
