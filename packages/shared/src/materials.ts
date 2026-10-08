import { z } from 'zod';

/**
 * Every material-related limit lives here and nowhere else. The API injects a `MaterialLimits`
 * object into its services (optionally overridden through environment variables) and returns the
 * effective values to the web app, so the UI never hard-codes numbers that the server may differ on.
 */
export interface MaterialLimits {
  /** Maximum characters of normalized text per material, pasted or extracted. */
  maxChars: number;
  maxPdfBytes: number;
  maxPdfPages: number;
  maxMaterialsPerExam: number;
}

export const DEFAULT_MATERIAL_LIMITS: MaterialLimits = {
  maxChars: 200_000,
  maxPdfBytes: 10 * 1024 * 1024,
  maxPdfPages: 100,
  maxMaterialsPerExam: 10,
};

/**
 * Heuristics that decide whether extracted text is usable. Fixed (not configurable) because they
 * define what "has selectable text" means, and changing them silently changes behavior.
 */
export const TEXT_QUALITY = {
  /** A document with fewer non-whitespace characters than this has no usable text. */
  minUsableChars: 50,
  /** A PDF page with fewer non-whitespace characters than this is flagged as low-text. */
  minUsableCharsPerPage: 20,
} as const;

export const materialLimitsSchema = z.object({
  maxChars: z.number(),
  maxPdfBytes: z.number(),
  maxPdfPages: z.number(),
  maxMaterialsPerExam: z.number(),
});

export const sourceTypeSchema = z.enum(['PDF', 'TEXT']);

export const createTextMaterialInputSchema = z.strictObject({
  // Only a byte-safety cap here. Normalization and the real character limit are enforced by the
  // service, so users get specific, helpful error messages instead of a generic validation error.
  text: z.string().max(2_000_000),
});
export type CreateTextMaterialInput = z.infer<typeof createTextMaterialInputSchema>;

export const materialSummarySchema = z.object({
  id: z.string(),
  examId: z.string(),
  sourceType: sourceTypeSchema,
  filename: z.string().nullable(),
  charCount: z.number(),
  /** Physical PDF page count. Null for pasted text. */
  pageCount: z.number().nullable(),
  /** PDF pages with little or no selectable text (kept, but may be missing content). Null for text. */
  lowTextPageCount: z.number().nullable(),
  createdAt: z.string(),
});
export type MaterialSummary = z.infer<typeof materialSummarySchema>;

export const addMaterialResponseSchema = z.object({
  material: materialSummarySchema,
  /** True when identical content was already added to this exam; nothing new was stored. */
  duplicate: z.boolean(),
});
export type AddMaterialResponse = z.infer<typeof addMaterialResponseSchema>;

export const listMaterialsResponseSchema = z.object({
  materials: z.array(materialSummarySchema),
  limits: materialLimitsSchema,
});
export type ListMaterialsResponse = z.infer<typeof listMaterialsResponseSchema>;
