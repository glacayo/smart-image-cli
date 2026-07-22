import path from "node:path";
import { z } from "zod";
import { categorySchema } from "../domain/taxonomy.js";
import { assertRootRelativeOutputDir } from "../domain/path-guard.js";

export const projectProviderConfigSchema = z
  .object({
    provider: z.enum(["ollama", "openrouter", "gemini"]).optional(),
    endpoint: z.string().url().optional(),
    model: z.string().min(1).optional()
  })
  .strict();

const outputDirSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    try {
      assertRootRelativeOutputDir(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "invalid outputDirs entry",
        path: []
      });
    }
  });

export const projectConfigSchema = z
  .object({
    provider: projectProviderConfigSchema.optional(),
    categories: z.array(categorySchema).default([]),
    outputDirs: z.array(outputDirSchema).default(["_out"])
  })
  .strict();

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

const SECRET_KEY_PATTERN = /(api[-_]?key|token|secret|password|credential)/i;

export function getProjectConfigPath(root: string): string {
  return path.join(root, ".img-ia", "config.json");
}

export function parseProjectConfig(value: unknown): ProjectConfig {
  assertProjectConfigHasNoSecrets(value);
  return projectConfigSchema.parse(value);
}

export function emptyProjectConfig(): ProjectConfig {
  return { categories: [], outputDirs: ["_out"] };
}

export function assertProjectConfigHasNoSecrets(value: unknown, trail: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertProjectConfigHasNoSecrets(item, [...trail, String(index)])
    );
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      const location = [...trail, key].join(".");
      throw new Error(`Project config must not contain provider secrets: ${location}`);
    }

    assertProjectConfigHasNoSecrets(nested, [...trail, key]);
  }
}
