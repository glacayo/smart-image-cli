import { EXIT_CODES } from "../cli/exit-codes.js";
import { errorResult, successResult } from "../cli/output.js";
import { createReadlinePrompter, isInteractiveTty, type Prompter } from "../cli/prompter.js";
import { defaultSecretRedactor } from "../adapters/secret-redactor.js";
import { readUserConfig, writeUserConfig, type ServiceOutcome } from "./runtime.js";

export type PixabaySetupServiceOptions = {
  userConfigPath?: string;
  prompter?: Prompter;
  isTty?: boolean;
  stderr?: NodeJS.WritableStream;
};

const DOCS = "https://pixabay.com/api/docs/";
const SETUP = "smart-img config pixabay setup";

/** Private masked Pixabay key setup. Non-TTY rejected; never accepts CLI args. */
export async function pixabaySetupService(
  options: PixabaySetupServiceOptions = {}
): Promise<ServiceOutcome> {
  const interactive = options.isTty ?? isInteractiveTty(process.stdin, process.stdout);
  const prompter = options.prompter ?? (interactive ? createReadlinePrompter() : undefined);
  if (!interactive || prompter === undefined) {
    return {
      result: errorResult(
        "config",
        "invalid_input",
        `Pixabay setup is interactive/private only. Obtain a key at ${DOCS} and run \`${SETUP}\` in a private terminal.`,
        {
          reason: "missing_pixabay_credential",
          obtain: `Obtain a Pixabay API key at ${DOCS}.`,
          setupCommand: `Run \`${SETUP}\` in a private interactive terminal and paste the key when prompted.`,
          retry: "Retry `smart-img pick --source pixabay` after setup completes."
        }
      ),
      exitCode: EXIT_CODES.INVALID_INPUT
    };
  }

  try {
    const apiKey = (await prompter.password("Pixabay API key")).trim();
    if (!apiKey) {
      return {
        result: errorResult("config", "invalid_input", "Pixabay API key must not be empty."),
        exitCode: EXIT_CODES.INVALID_INPUT
      };
    }
    const path = options.userConfigPath;
    await writeUserConfig({ ...(await readUserConfig(path)), pixabay: { apiKey } }, path);
    options.stderr?.write("smart-img config pixabay setup: saved Pixabay API key (user-scoped)\n");
    return {
      result: successResult("config", {
        action: "pixabay-setup",
        scope: "user",
        pixabay: { apiKey: "[REDACTED]" },
        guidance: { next: "Pixabay API key saved securely in user-scoped config." }
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
