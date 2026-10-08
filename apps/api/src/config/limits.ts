import { DEFAULT_MATERIAL_LIMITS, type MaterialLimits } from '@prepflow/shared';
import type { Env } from './env.js';

/** The effective material limits: shared defaults, overridden by optional environment variables. */
export function materialLimitsFromEnv(env: Env): MaterialLimits {
  return {
    maxChars: env.MAX_MATERIAL_CHARS ?? DEFAULT_MATERIAL_LIMITS.maxChars,
    maxPdfBytes:
      env.MAX_PDF_MB === undefined
        ? DEFAULT_MATERIAL_LIMITS.maxPdfBytes
        : Math.round(env.MAX_PDF_MB * 1024 * 1024),
    maxPdfPages: env.MAX_PDF_PAGES ?? DEFAULT_MATERIAL_LIMITS.maxPdfPages,
    maxMaterialsPerExam: env.MAX_MATERIALS_PER_EXAM ?? DEFAULT_MATERIAL_LIMITS.maxMaterialsPerExam,
  };
}
