import type { Command } from "commander";
import { emitResult } from "../cli/output.js";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { configService } from "../app/config-service.js";
import { serviceError } from "../app/runtime.js";

export function registerConfigCommand(program: Command): void {
  program
    .command("config")
    .description("Inspect or update user and project configuration.")
    .argument("[action]", "list, get, or set")
    .argument("[key]", "configuration key")
    .argument("[value]", "configuration value for set")
    .option("--project", "target project-local config instead of per-user config")
    .option("--root <root>", "project root for --project config")
    .action(
      (
        action: string | undefined,
        key: string | undefined,
        value: string | undefined,
        options: { project?: boolean; root?: string },
        command: Command
      ) => {
        return (async () => {
          const globals = command.optsWithGlobals<{ json?: boolean }>();
          try {
            const outcome = await configService(action, key, value, options);
            emitResult(outcome.result, { json: globals.json });
            process.exitCode = outcome.exitCode;
          } catch (error) {
            emitResult(serviceError("config", "invalid_input", error), { json: globals.json });
            process.exitCode = EXIT_CODES.INVALID_INPUT;
          }
        })();
      }
    );
}
