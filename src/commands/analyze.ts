import type { Command } from "commander";
import { EXIT_CODES } from "../cli/exit-codes.js";
import { emitResult } from "../cli/output.js";
import { analyzeService } from "../app/analyze-service.js";
import { loadTaxonomy, resolveProviderConfig, serviceError } from "../app/runtime.js";
import { OpenAICompatVisionProvider } from "../adapters/vision/openai-compat.js";

export function registerAnalyzeCommand(program: Command): void {
  program
    .command("analyze")
    .description("Analyze, classify, rename, and organize images under a root folder.")
    .argument("<root>", "project root to scan")
    .option("--dry-run", "report planned writes without changing files")
    .option("--fail-fast", "abort on the first per-file failure")
    .action(
      async (root: string, options: { dryRun?: boolean; failFast?: boolean }, command: Command) => {
        const globals = command.optsWithGlobals<{ json?: boolean }>();
        try {
          const provider = await buildProvider(root);
          const outcome = await analyzeService(root, options, {
            provider,
            taxonomy: await loadTaxonomy(root)
          });
          emitResult(outcome.result, { json: globals.json });
          process.exitCode = outcome.exitCode;
        } catch (error) {
          emitResult(serviceError("analyze", "invalid_input", error), { json: globals.json });
          process.exitCode = EXIT_CODES.INVALID_INPUT;
        }
      }
    );
}

async function buildProvider(root: string): Promise<OpenAICompatVisionProvider> {
  const provider = await resolveProviderConfig(root);
  return new OpenAICompatVisionProvider({
    id: provider.id,
    endpoint: provider.endpoint,
    model: provider.model,
    apiKey: provider.apiKey
  });
}
