import { z } from "zod";

export const categoryIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "category ids must be lowercase kebab-case");

export const categorySchema = z
  .object({
    id: categoryIdSchema,
    label: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([])
  })
  .strict();

export const taxonomySchema = z
  .object({
    version: z.number().int().positive(),
    categories: z.array(categorySchema).min(1)
  })
  .strict();

export type Category = z.infer<typeof categorySchema>;
export type Taxonomy = z.infer<typeof taxonomySchema>;

export function createTaxonomy(
  defaultTaxonomy: Taxonomy,
  extensions: readonly Category[] = []
): Taxonomy {
  const parsedDefault = taxonomySchema.parse(defaultTaxonomy);
  const byId = new Map<string, Category>();

  for (const category of [
    ...parsedDefault.categories,
    ...extensions.map((item) => categorySchema.parse(item))
  ]) {
    byId.set(category.id, category);
  }

  return { version: parsedDefault.version, categories: [...byId.values()] };
}

export function isKnownCategory(taxonomy: Taxonomy, categoryId: string): boolean {
  return taxonomy.categories.some((category) => category.id === categoryId);
}

export function assertKnownCategories(
  taxonomy: Taxonomy,
  categoryIds: readonly string[]
): string[] {
  const unknown = categoryIds.filter((categoryId) => !isKnownCategory(taxonomy, categoryId));

  if (unknown.length > 0) {
    throw new Error(`Unknown image categories: ${unknown.join(", ")}`);
  }

  return [...categoryIds];
}

export function primaryCategory(
  categoryIds: readonly string[],
  fallback = "uncategorized"
): string {
  return categoryIds[0] ?? fallback;
}
