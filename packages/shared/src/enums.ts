import { z } from 'zod';

/**
 * Enumerations shared by the API, the database mapping and the web app.
 * The values deliberately mirror the Prisma enums in apps/api/prisma/schema.prisma.
 * They are also what Gemma is asked to return, so they are plain, unambiguous words.
 */

export const difficultySchema = z.enum(['EASY', 'MEDIUM', 'HARD']);
export type Difficulty = z.infer<typeof difficultySchema>;

export const importanceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type Importance = z.infer<typeof importanceSchema>;

/** Whether a topic was explicitly present in the material or inferred by the model. */
export const topicOriginSchema = z.enum(['EXTRACTED', 'INFERRED']);
export type TopicOrigin = z.infer<typeof topicOriginSchema>;

export const topicStatusSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']);
export type TopicStatus = z.infer<typeof topicStatusSchema>;

export const taskTypeSchema = z.enum(['STUDY', 'REVISION']);
export type TaskType = z.infer<typeof taskTypeSchema>;

export const taskStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** Days of week as numbers, 0 = Sunday ... 6 = Saturday (same as JavaScript's Date#getDay). */
export const weekdaySchema = z.number().int().min(0).max(6);

/**
 * How safely a topic fits into the available time, decided by the deterministic planner:
 * MUST (protected), SHOULD, IF_TIME (first to go when plans change) and DEFER (does not fit).
 */
export const priorityTierSchema = z.enum(['MUST', 'SHOULD', 'IF_TIME', 'DEFER']);
export type PriorityTier = z.infer<typeof priorityTierSchema>;

/** Why a plan version exists. */
export const planTriggerSchema = z.enum(['GENERATE', 'RECOVER_MISSED', 'REPLAN_REMAINING']);
export type PlanTrigger = z.infer<typeof planTriggerSchema>;

export const planStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export type PlanStatus = z.infer<typeof planStatusSchema>;
