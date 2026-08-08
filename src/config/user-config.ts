import os from "node:os";
import path from "node:path";
import { z } from "zod";

export const providerConfigSchema = z
  .object({
    provider: z.enum(["ollama", "openrouter", "gemini"]).default("ollama"),
    endpoint: z.string().url().optional(),
    model: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional()
  })
  .strict();

export const pixabayConfigSchema = z
  .object({
    apiKey: z.string().min(1).optional()
  })
  .strict();

export const userConfigSchema = z
  .object({
    activeProvider: z.enum(["ollama", "openrouter", "gemini"]).default("ollama"),
    providers: z.record(providerConfigSchema).default({}),
    pixabay: pixabayConfigSchema.default({})
  })
  .strict();

export type UserConfig = z.infer<typeof userConfigSchema>;
export type UserConfigInput = z.input<typeof userConfigSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type PixabayConfig = z.infer<typeof pixabayConfigSchema>;

export function getUserConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32" && env.APPDATA) {
    return path.join(env.APPDATA, "smart-image-cli");
  }

  if (env.XDG_CONFIG_HOME) {
    return path.join(env.XDG_CONFIG_HOME, "smart-image-cli");
  }

  return path.join(os.homedir(), ".config", "smart-image-cli");
}

export function getUserConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getUserConfigDir(env), "config.json");
}

/** Parse user config; legacy on-disk `unsplash` is stripped from normalized output (not migrated). */
export function parseUserConfig(value: unknown): UserConfig {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "unsplash" in value) {
    const { unsplash: _legacy, ...rest } = value as Record<string, unknown>;
    void _legacy;
    return userConfigSchema.parse(rest);
  }
  return userConfigSchema.parse(value);
}

export function emptyUserConfig(): UserConfig {
  return parseUserConfig({});
}
