import { z } from "zod";
import { categoryIdSchema } from "./taxonomy.js";

export const orientationSchema = z.enum(["landscape", "portrait", "square", "panorama"]);

export const analysisSchema = z
  .object({
    subject: z.string().min(1),
    categories: z.array(categoryIdSchema).min(1),
    orientation: orientationSchema,
    altText: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    suggestedSlug: z.string().min(1)
  })
  .strict();

export type ImageAnalysis = z.infer<typeof analysisSchema>;
export type ImageOrientation = z.infer<typeof orientationSchema>;

export function parseImageAnalysis(value: unknown): ImageAnalysis {
  return analysisSchema.parse(value);
}
