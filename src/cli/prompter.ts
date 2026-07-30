import readline from "node:readline/promises";
import type { Interface } from "node:readline/promises";

export type Prompter = {
  select(message: string, choices: readonly string[]): Promise<string>;
  input(message: string, options?: { defaultValue?: string }): Promise<string>;
  password(message: string): Promise<string>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
};

export type CreateReadlinePrompterOptions = {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  createInterface?: (options: {
    input: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
  }) => Pick<Interface, "question" | "close">;
};

/** True only when both stdin and stdout are interactive TTYs. */
export function isInteractiveTty(
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout
): boolean {
  return stdin.isTTY === true && stdout.isTTY === true;
}

/**
 * readline/promises-backed prompter for guided setup.
 * Password prompts use a muted stdout writer so secrets are not echoed.
 */
export function createReadlinePrompter(options: CreateReadlinePrompterOptions = {}): Prompter {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const createInterface =
    options.createInterface ??
    ((opts: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream }) =>
      readline.createInterface(opts));

  async function readHiddenLine(prompt: string): Promise<string> {
    const rawMode = stdin.setRawMode;
    if (typeof rawMode !== "function" || stdin.isTTY !== true) {
      return withMutedInterface(prompt);
    }

    stdout.write(`${prompt} (hidden): `);
    stdin.resume();
    rawMode.call(stdin, true);

    return new Promise<string>((resolve, reject) => {
      let value = "";

      const cleanup = () => {
        stdin.off("data", onData);
        rawMode.call(stdin, false);
        stdout.write("\n");
      };

      const finish = () => {
        cleanup();
        resolve(value);
      };

      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onData = (chunk: Buffer | string) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        for (const char of text) {
          if (char === "\u0003") {
            fail(new Error("Password entry cancelled"));
            return;
          }
          if (char === "\r" || char === "\n") {
            finish();
            return;
          }
          if (char === "\b" || char === "\u007f") {
            value = value.slice(0, -1);
            continue;
          }
          value += char;
        }
      };

      stdin.on("data", onData);
    });
  }

  async function withInterface<T>(
    output: NodeJS.WritableStream,
    run: (rl: Pick<Interface, "question" | "close">) => Promise<T>
  ): Promise<T> {
    const rl = createInterface({ input: stdin, output });
    try {
      return await run(rl);
    } finally {
      rl.close();
    }
  }

  async function withMutedInterface(message: string): Promise<string> {
    const muted: NodeJS.WritableStream = {
      write: () => true,
      end: () => muted,
      on: () => muted,
      once: () => muted,
      emit: () => false,
      addListener: () => muted,
      removeListener: () => muted,
      prependListener: () => muted,
      prependOnceListener: () => muted,
      removeAllListeners: () => muted,
      setMaxListeners: () => muted,
      getMaxListeners: () => 0,
      listeners: () => [],
      rawListeners: () => [],
      listenerCount: () => 0,
      eventNames: () => [],
      off: () => muted,
      writable: true
    } as unknown as NodeJS.WritableStream;

    stdout.write(`${message} (hidden): `);
    try {
      return await withInterface(muted, async (rl) => {
        const value = await rl.question("");
        return value;
      });
    } finally {
      stdout.write("\n");
    }
  }

  return {
    async select(message, choices) {
      if (choices.length === 0) {
        throw new Error("select requires at least one choice");
      }
      const listing = choices.map((choice, index) => `  ${index + 1}) ${choice}`).join("\n");
      return withInterface(stdout, async (rl) => {
        for (;;) {
          const answer = (await rl.question(`${message}\n${listing}\nEnter number: `)).trim();
          const asNumber = Number.parseInt(answer, 10);
          if (
            Number.isInteger(asNumber) &&
            asNumber >= 1 &&
            asNumber <= choices.length &&
            choices[asNumber - 1] !== undefined
          ) {
            return choices[asNumber - 1]!;
          }
          const byValue = choices.find((c) => c.toLowerCase() === answer.toLowerCase());
          if (byValue !== undefined) return byValue;
          stdout.write("Invalid selection. Try again.\n");
        }
      });
    },

    async input(message, inputOptions = {}) {
      return withInterface(stdout, async (rl) => {
        const suffix =
          inputOptions.defaultValue !== undefined && inputOptions.defaultValue.length > 0
            ? ` [${inputOptions.defaultValue}]`
            : "";
        const answer = (await rl.question(`${message}${suffix}: `)).trim();
        if (answer.length === 0 && inputOptions.defaultValue !== undefined) {
          return inputOptions.defaultValue;
        }
        return answer;
      });
    },

    async password(message) {
      return readHiddenLine(message);
    },

    async confirm(message, defaultValue = true) {
      const hint = defaultValue ? "Y/n" : "y/N";
      return withInterface(stdout, async (rl) => {
        const answer = (await rl.question(`${message} (${hint}): `)).trim().toLowerCase();
        if (answer.length === 0) return defaultValue;
        if (answer === "y" || answer === "yes") return true;
        if (answer === "n" || answer === "no") return false;
        return defaultValue;
      });
    }
  };
}
