#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import { registerAnalyzeCommand } from "../commands/analyze.js";
import { registerConfigCommand } from "../commands/config.js";
import { registerDoctorCommand } from "../commands/doctor.js";
import { registerListCommand } from "../commands/list.js";
import { registerMarkUsedCommand } from "../commands/mark-used.js";
import { registerOptimizeCommand } from "../commands/optimize.js";
import { registerPickCommand } from "../commands/pick.js";
import { registerStatsCommand } from "../commands/stats.js";
import { EXIT_CODES } from "./exit-codes.js";
import { emitResult, errorResult } from "./output.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("smart-img")
    .description("Analyze, organize, optimize, and select website image assets.")
    .version("0.3.0")
    .option("--json", "emit a single JSON object on stdout")
    .exitOverride();

  registerAnalyzeCommand(program);
  registerOptimizeCommand(program);
  registerPickCommand(program);
  registerMarkUsedCommand(program);
  registerListCommand(program);
  registerStatsCommand(program);
  registerConfigCommand(program);
  registerDoctorCommand(program);

  return program;
}

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(argv as string[]);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        process.exitCode = EXIT_CODES.SUCCESS;
        return;
      }

      const wantsJson = argv.includes("--json");
      emitResult(errorResult("smart-img", "invalid_input", error.message), { json: wantsJson });
      process.exitCode = EXIT_CODES.INVALID_INPUT;
      return;
    }

    throw error;
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected failure";
    emitResult(errorResult("smart-img", "unexpected_error", message), {
      json: process.argv.includes("--json")
    });
    process.exitCode = EXIT_CODES.FILESYSTEM_ERROR;
  });
}
