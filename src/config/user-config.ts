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

export const unsplashConfigSchema = z
  .object({
    accessKey: z.string().min(1).optional()
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
    unsplash: unsplashConfigSchema.default({}),
    pixabay: pixabayConfigSchema.default({})
  })
  .strict();

export type UserConfig = z.infer<typeof userConfigSchema>;
export type UserConfigInput = z.input<typeof userConfigSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type UnsplashConfig = z.infer<typeof unsplashConfigSchema>;
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

export function parseUserConfig(value: unknown): UserConfig {
  return userConfigSchema.parse(value);
}

export function emptyUserConfig(): UserConfig {
  return parseUserConfig({});
}
