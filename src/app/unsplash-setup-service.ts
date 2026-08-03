import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import { createReadlinePrompter, isInteractiveTty, type Prompter } from "../cli/prompter.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import { readUserConfig, writeUserConfig, type ServiceOutcome } from "./runtime.js";

export type UnsplashSetupServiceOptions = {
  userConfigPath?: string;
  prompter?: Prompter;
  /** Injected TTY detection for tests. Production uses stdin+stdout isTTY. */
  isTty?: boolean;
  /** When provided, human-mode outcome line is written here. */
  stderr?: NodeJS.WritableStream;
};

const UNSPLASH_DEVELOPERS_URL = "https://unsplash.com/developers";
const UNSPLASH_SETUP_COMMAND = "smart-img config unsplash setup";

/**
 * Private Unsplash Access Key setup. The Access Key is accepted ONLY through a
 * masked interactive prompt — never through a CLI argument, an environment
 * variable, or process args — so the value is never placed in shell history,
 * process lists, logs, or agent-controlled buffers.
 *
 * Persists the key only in user-scoped config with mode 0600 and never echoes
 * the value (output is redacted to `[REDACTED]`).
 *
 * Non-TTY / JSON invocations never prompt and return actionable, secret-free
 * guidance telling the human to run the command in a private interactive
 * terminal.
 *
 * This is distinct from the Ollama/vision provider setup
 * (`smart-img config setup`): Unsplash is an image source, not an AI vision
 * provider, and its key lives under `unsplash.accessKey` rather than
 * `providers.<id>.apiKey`.
 *
 * `UNSPLASH_ACCESS_KEY` remains an operator-managed runtime credential
 * override for `pick --source unsplash` (resolved by the credential resolver
 * at runtime), but it is NOT accepted as a setup input here.
 */
export async function unsplashSetupService(
  options: UnsplashSetupServiceOptions = {}
): Promise<ServiceOutcome> {
  const interactive = options.isTty ?? isInteractiveTty(process.stdin, process.stdout);
  const prompter = options.prompter ?? (interactive ? createReadlinePrompter() : undefined);

  if (!interactive || prompter === undefined) {
    return missingKeyNonInteractive();
  }

  try {
    const value = await prompter.password("Unsplash Access Key");
    const accessKey = value.trim();

    if (!accessKey || accessKey.length === 0) {
      return {
        result: errorResult("config", "invalid_input", "Unsplash Access Key must not be empty."),
        exitCode: EXIT_CODES.INVALID_INPUT
      };
    }

    const userConfigPath = options.userConfigPath;
    const current = await readUserConfig(userConfigPath);
    const next = { ...current, unsplash: { accessKey } };
    await writeUserConfig(next, userConfigPath);

    writeHumanLine(
      options.stderr,
      `smart-img config unsplash setup: saved Unsplash Access Key (user-scoped)\n`
    );

    return {
      result: successResult("config", {
        action: "unsplash-setup",
        scope: "user",
        unsplash: { accessKey: "[REDACTED]" },
        guidance: {
          next: `Retry \`smart-img pick --source unsplash\` with your --query.`
        }
      }),
      exitCode: EXIT_CODES.SUCCESS
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? defaultSecretRedactor.mask(error.message)
        : defaultSecretRedactor.mask(String(error));
    return {
      result: errorResult("config", "invalid_input", message),
      exitCode: EXIT_CODES.INVALID_INPUT
    };
  }
}

function missingKeyNonInteractive(): ServiceOutcome {
  return {
    result: errorResult(
      "config",
      "invalid_input",
      "Unsplash setup is interactive/private only. Obtain a key at https://unsplash.com/developers and run `smart-img config unsplash setup` in a private terminal.",
      {
        reason: "missing_unsplash_credential",
        obtain: `Obtain an Unsplash Access Key at ${UNSPLASH_DEVELOPERS_URL}.`,
        setupCommand: `Run \`${UNSPLASH_SETUP_COMMAND}\` in a private interactive terminal and paste the key when prompted.`,
        retry: `Retry \`smart-img pick --source unsplash\` after setup completes.`
      }
    ),
    exitCode: EXIT_CODES.INVALID_INPUT
  };
}

function writeHumanLine(stderr: NodeJS.WritableStream | undefined, line: string): void {
  if (stderr === undefined) return;
  stderr.write(line);
}
