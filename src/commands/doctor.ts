import type { Command } from "commander";
import { emitResult } from "../cli/output.js";
import { doctorService } from "../app/doctor-service.js";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description(
      "Check runtime prerequisites and provider readiness (endpoint + selected model reachability)."
    )
    .option("--root <root>", "project root to inspect")
    .action(async (options: { root?: string }, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean }>();
      const outcome = await doctorService(options);
      emitResult(outcome.result, { json: globals.json });
      process.exitCode = outcome.exitCode;
    });
}
