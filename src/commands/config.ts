import type { Command } from "commander";
import { emitResult } from "../cli/output.js";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { configService } from "../app/config-service.js";
import { serviceError } from "../app/runtime.js";

export function registerConfigCommand(program: Command): void {
  program
    .command("config")
    .description("Inspect or update user and project configuration.")
    .argument("[action]", "list, get, set, or models")
    .argument("[key]", "configuration key")
    .argument("[value]", "configuration value for set")
    .option("--project", "target project-local config instead of per-user config")
    .option("--root <root>", "project root for --project config")
    .option("--provider <id>", "provider id for models / connection test (ollama|openrouter|gemini)")
    .option("--endpoint <url>", "override provider endpoint for models / connection test")
    .action(
      (
        action: string | undefined,
        key: string | undefined,
        value: string | undefined,
        options: {
          project?: boolean;
          root?: string;
          provider?: string;
          endpoint?: string;
        },
        command: Command
      ) => {
        return (async () => {
          const globals = command.optsWithGlobals<{ json?: boolean }>();
          const useJson = globals.json === true;
          try {
            const outcome = await configService(action, key, value, {
              ...(options.project !== undefined ? { project: options.project } : {}),
              ...(options.root !== undefined ? { root: options.root } : {}),
              ...(options.provider !== undefined ? { provider: options.provider } : {}),
              ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
              // Human mode: connection-test outcome goes to stderr per design.
              ...(useJson ? {} : { stderr: process.stderr })
            });
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
