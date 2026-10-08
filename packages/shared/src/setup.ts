import { z } from 'zod';
import { isValidIsoDate } from './dates.js';
import { weekdaySchema } from './enums.js';

export const SETUP_LIMITS = {
  minMinutesPerDay: 15,
  maxMinutesPerDay: 720,
  maxWeakTopicHints: 20,
  maxHintLength: 80,
  maxBlockedDates: 60,
  /** Share of every study day held back for delays and recovery. */
  maxBufferPct: 30,
  defaultBufferPct: 10,
} as const;

export const isoDateSchema = z
  .string()
  .refine(isValidIsoDate, { message: 'Use a real calendar date in YYYY-MM-DD format.' });

const studyDaysSchema = z
  .array(weekdaySchema)
  .min(1, 'Pick at least one day you can study.')
  .max(7)
  .refine((days) => new Set(days).size === days.length, {
    message: 'Each day can only be picked once.',
  })
  .transform((days) => [...days].sort((a, b) => a - b));

/** Trims, drops empties and removes case-insensitive duplicates while keeping the first spelling. */
const weakTopicHintsSchema = z
  .array(z.string().trim().min(1).max(SETUP_LIMITS.maxHintLength))
  .max(SETUP_LIMITS.maxWeakTopicHints)
  .transform((hints) => {
    const seen = new Set<string>();
    return hints.filter((hint) => {
      const key = hint.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

const minutesPerDaySchema = z
  .number()
  .int()
  .min(SETUP_LIMITS.minMinutesPerDay, 'Plan for at least 15 minutes a day.')
  .max(SETUP_LIMITS.maxMinutesPerDay, 'Daily study time can be at most 12 hours.');

const confidenceSchema = z.number().int().min(1).max(5);

const bufferPctSchema = z
  .number()
  .int()
  .min(0)
  .max(SETUP_LIMITS.maxBufferPct, `Keep the buffer at ${SETUP_LIMITS.maxBufferPct}% or less.`);

/** Specific days off. Sorted and de-duplicated so the same set always compares equal. */
const blockedDatesSchema = z
  .array(isoDateSchema)
  .max(SETUP_LIMITS.maxBlockedDates)
  .transform((dates) => [...new Set(dates)].sort());

export const createProfileInputSchema = z.strictObject({
  nickname: z.string().trim().min(1, 'Add a name or nickname.').max(40),
  examName: z.string().trim().min(2, 'Name the exam you are preparing for.').max(100),
  examDate: isoDateSchema,
  minutesPerDay: minutesPerDaySchema,
  studyDays: studyDaysSchema,
  weakTopicHints: weakTopicHintsSchema.default([]),
  confidence: confidenceSchema.optional(),
  blockedDates: blockedDatesSchema.default([]),
  bufferPct: bufferPctSchema.default(SETUP_LIMITS.defaultBufferPct),
});
export type CreateProfileInput = z.infer<typeof createProfileInputSchema>;

/** Partial update. `confidence: null` clears it. At least one field is required. */
export const updateExamInputSchema = z
  .strictObject({
    examName: z.string().trim().min(2).max(100),
    examDate: isoDateSchema,
    minutesPerDay: minutesPerDaySchema,
    studyDays: studyDaysSchema,
    weakTopicHints: weakTopicHintsSchema,
    confidence: confidenceSchema.nullable(),
    blockedDates: blockedDatesSchema,
    bufferPct: bufferPctSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Send at least one field to update.',
  });
export type UpdateExamInput = z.infer<typeof updateExamInputSchema>;

export const examResponseSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  nickname: z.string(),
  name: z.string(),
  examDate: z.string(),
  minutesPerDay: z.number(),
  studyDays: z.array(weekdaySchema),
  weakTopicHints: z.array(z.string()),
  confidence: z.number().nullable(),
  revisionIntervalsDays: z.array(z.number()),
  revisionReservePct: z.number(),
  blockedDates: z.array(z.string()),
  bufferPct: z.number(),
  availability: z.object({
    daysUntilExam: z.number(),
    studyDays: z.number(),
    availableMinutes: z.number(),
  }),
});
export type ExamResponse = z.infer<typeof examResponseSchema>;

export const createProfileResponseSchema = z.object({
  profileId: z.string(),
  exam: examResponseSchema,
});
export type CreateProfileResponse = z.infer<typeof createProfileResponseSchema>;
