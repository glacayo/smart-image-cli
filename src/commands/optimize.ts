import type { Command } from "commander";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { emitResult, pendingResult } from "../cli/output.js";

export function registerOptimizeCommand(program: Command): void {
  program
    .command("optimize")
    .description("Produce a web-ready asset without upscaling or leaking metadata.")
    .argument("<root>", "project root")
    .argument("<source>", "source image path inside the root")
    .option("--format <format>", "output format: jpg, png, webp, or avif")
    .option("--width <px>", "requested width in pixels")
    .option("--height <px>", "requested height in pixels")
    .option("--max-width <px>", "maximum width in pixels")
    .option("--max-height <px>", "maximum height in pixels")
    .option("--keep-metadata", "preserve metadata by explicit opt-in")
    .action(
      (
        root: string,
        source: string,
        options: Record<string, string | boolean>,
        command: Command
      ) => {
        const globals = command.optsWithGlobals<{ json?: boolean }>();
        emitResult(pendingResult("optimize", { root, source, options }), { json: globals.json });
        process.exitCode = EXIT_CODES.INVALID_INPUT;
      }
    );
}
