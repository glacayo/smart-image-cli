import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  createReadlinePrompter,
  isInteractiveTty,
  type Prompter
} from "../../src/cli/prompter.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isInteractiveTty", () => {
  it("returns true only when both stdin and stdout are TTYs", () => {
    expect(
      isInteractiveTty(
        { isTTY: true } as NodeJS.ReadStream,
        { isTTY: true } as NodeJS.WriteStream
      )
    ).toBe(true);
    expect(
      isInteractiveTty(
        { isTTY: false } as NodeJS.ReadStream,
        { isTTY: true } as NodeJS.WriteStream
      )
    ).toBe(false);
    expect(
      isInteractiveTty(
        { isTTY: true } as NodeJS.ReadStream,
        { isTTY: false } as NodeJS.WriteStream
      )
    ).toBe(false);
  });
});

describe("createReadlinePrompter", () => {
  it("disables TTY echo while reading password input", async () => {
    const secret = ["sk", "live", "rawmode-secret-123"].join("-");
    const writes: string[] = [];
    const stdin = Object.assign(new EventEmitter(), {
      isTTY: true,
      resume: vi.fn(),
      setRawMode: vi.fn()
    }) as unknown as NodeJS.ReadStream;
    const stdout = {
      isTTY: true,
      write(chunk: string | Uint8Array): boolean {
        writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }
    } as unknown as NodeJS.WriteStream;

    const prompter = createReadlinePrompter({ stdin, stdout });
    const pending = prompter.password("API key");

    stdin.emit("data", Buffer.from(`${secret}\n`));

    await expect(pending).resolves.toBe(secret);
    expect(stdin.resume).toHaveBeenCalled();
    expect(stdin.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(stdin.setRawMode).toHaveBeenNthCalledWith(2, false);
    expect(writes.join("")).toMatch(/api key|hidden/i);
    expect(writes.join("")).not.toContain(secret);
  });

  it("masks password input and never echoes the secret value on stdout", async () => {
    const secret = ["sk", "live", "promptersecret12345678901"].join("-");
    const writes: string[] = [];
    const stdout = {
      isTTY: true,
      write(chunk: string | Uint8Array): boolean {
        writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      }
    } as unknown as NodeJS.WriteStream;

    const question = vi.fn(async () => secret);
    const close = vi.fn();
    const createInterface = vi.fn(() => ({ question, close }));

    const prompter: Prompter = createReadlinePrompter({
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout,
      createInterface
    });

    const value = await prompter.password("API key");
    expect(value).toBe(secret);
    expect(question).toHaveBeenCalled();
    // Visible guidance is written to real stdout; readline question itself is muted.
    const visible = writes.join("").toLowerCase();
    expect(visible).toMatch(/api key|secret|hidden|mask|\*/i);
    expect(visible).not.toContain(secret.toLowerCase());
    expect(writes.join("")).not.toContain(secret);
    expect(close).toHaveBeenCalled();
  });

  it("selects from choices and accepts free-form input for manual model fallback", async () => {
    const question = vi
      .fn()
      .mockResolvedValueOnce("2")
      .mockResolvedValueOnce("manual-model-x");
    const close = vi.fn();
    const createInterface = vi.fn(() => ({ question, close }));
    const stdout = {
      isTTY: true,
      write: vi.fn(() => true)
    } as unknown as NodeJS.WriteStream;

    const prompter = createReadlinePrompter({
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout,
      createInterface
    });

    const selected = await prompter.select("Choose provider", ["ollama", "openrouter", "gemini"]);
    expect(selected).toBe("openrouter");

    const typed = await prompter.input("Model id");
    expect(typed).toBe("manual-model-x");
  });

  it("confirm accepts yes/no answers with default", async () => {
    const question = vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce("n");
    const close = vi.fn();
    const createInterface = vi.fn(() => ({ question, close }));

    const prompter = createReadlinePrompter({
      stdin: { isTTY: true } as NodeJS.ReadStream,
      stdout: { isTTY: true, write: vi.fn(() => true) } as unknown as NodeJS.WriteStream,
      createInterface
    });

    await expect(prompter.confirm("Continue?", true)).resolves.toBe(true);
    await expect(prompter.confirm("Continue?", true)).resolves.toBe(false);
  });
});
