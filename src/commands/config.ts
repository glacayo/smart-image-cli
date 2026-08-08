import type { Command } from "commander";
import { emitResult } from "../cli/output.js";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { configService } from "../app/config-service.js";
import { serviceError } from "../app/runtime.js";

export function registerConfigCommand(program: Command): void {
  program
    .command("config")
    .description("Inspect or update user and project configuration.")
    .argument("[action]", "list, get, set, models, setup, unsplash setup, or pixabay setup")
    .argument("[key]", "configuration key (or `setup` for the `unsplash`/`pixabay` action)")
    .argument("[value]", "configuration value for set")
    .option("--project", "target project-local config instead of per-user config")
    .option("--root <root>", "project root for --project config")
    .option(
      "--provider <id>",
      "provider id for setup/models/connection test (ollama|openrouter|gemini)"
    )
    .option("--endpoint <url>", "override provider endpoint for setup/models/connection test")
    .option("--api-key <key>", "API key for non-interactive config setup")
    .option("--model <id>", "model id for non-interactive config setup")
    .option("--yes", "accept setup warnings without interactive confirmation")
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
          apiKey?: string;
          model?: string;
          yes?: boolean;
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
              ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
              ...(options.model !== undefined ? { model: options.model } : {}),
              ...(options.yes !== undefined ? { yes: options.yes } : {}),
              // Agent/JSON mode must never hang on TTY prompts (setup non-interactive contract).
              ...(useJson ? { isTty: false } : {}),
              // Human mode: connection-test / setup outcome goes to stderr per design.
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
