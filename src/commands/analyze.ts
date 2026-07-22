import type { Command } from "commander";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { emitResult, pendingResult } from "../cli/output.js";

export function registerAnalyzeCommand(program: Command): void {
  program
    .command("analyze")
    .description("Analyze, classify, rename, and organize images under a root folder.")
    .argument("<root>", "project root to scan")
    .option("--dry-run", "report planned writes without changing files")
    .option("--fail-fast", "abort on the first per-file failure")
    .action((root: string, options: { dryRun?: boolean; failFast?: boolean }, command: Command) => {
      const globals = command.optsWithGlobals<{ json?: boolean }>();
      emitResult(pendingResult("analyze", { root, options }), { json: globals.json });
      process.exitCode = EXIT_CODES.INVALID_INPUT;
    });
}
