import { EXIT_CODES, type ExitCode } from "./exit-codes.js";

export type CliStatus = "success" | "partial" | "failed";

export type CliResult = {
  ok: boolean;
  status: CliStatus;
  command?: string;
  reason?: string;
  message?: string;
  details?: unknown;
};

export type OutputOptions = {
  json?: boolean | undefined;
  stdout?: (NodeJS.WritableStream & { isTTY?: boolean | undefined }) | undefined;
  stderr?: NodeJS.WritableStream | undefined;
};

export function shouldUseJsonOutput(options: Pick<OutputOptions, "json" | "stdout"> = {}): boolean {
  return options.json === true || options.stdout?.isTTY !== true;
}

export function successResult(command: string, details?: unknown): CliResult {
  return { ok: true, status: "success", command, details };
}

export function pendingResult(command: string, details?: unknown): CliResult {
  return {
    ok: false,
    status: "failed",
    command,
    reason: "not_implemented",
    message: `${command} is registered, but its application service is scheduled for a later phase.`,
    details
  };
}

export function errorResult(
  command: string,
  reason: string,
  message: string,
  details?: unknown
): CliResult {
  return { ok: false, status: "failed", command, reason, message, details };
}

export function emitResult(result: CliResult, options: OutputOptions = {}): void {
  const stdout = (options.stdout ?? process.stdout) as NodeJS.WritableStream & {
    isTTY?: boolean | undefined;
  };

  if (shouldUseJsonOutput({ json: options.json, stdout })) {
    stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  stdout.write(`${formatHumanResult(result)}\n`);
}

export function exitCodeForResult(
  result: CliResult,
  fallback: ExitCode = EXIT_CODES.INVALID_INPUT
): ExitCode {
  if (result.ok) {
    return EXIT_CODES.SUCCESS;
  }

  return fallback;
}

function formatHumanResult(result: CliResult): string {
  if (result.ok) {
    return result.message ?? `${result.command ?? "img"}: success`;
  }

  const reason = result.reason ? ` (${result.reason})` : "";
  return `${result.command ?? "img"}: ${result.message ?? "failed"}${reason}`;
}
