import { difficultySchema, importanceSchema, topicOriginSchema } from '@prepflow/shared';
import { z } from 'zod';

/** What the model is asked to classify; the application converts this to minutes (see effort.ts). */
export const effortClassSchema = z.enum(['QUICK', 'STANDARD', 'EXTENSIVE']);
export type EffortClass = z.infer<typeof effortClassSchema>;

export const revisionNeedSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

const text = (max: number) => z.string().trim().min(1).max(max);

export const rawEvidenceSchema = z.object({ chunkId: text(64), quote: z.string().max(2000) });

/**
 * One topic as returned by the model. `z.object` strips unknown keys, so extra fields the model
 * invents never reach the rest of the system. Page numbers are deliberately NOT part of the schema.
 */
export const rawTopicSchema = z.object({
  name: text(120),
  /** Name of the parent topic when this is a subtopic. */
  parent: z.string().trim().max(120).nullish(),
  summary: z.string().trim().max(600).default(''),
  difficulty: difficultySchema,
  importance: importanceSchema,
  effort: effortClassSchema,
  revisionNeed: revisionNeedSchema.default('MEDIUM'),
  origin: topicOriginSchema.default('EXTRACTED'),
  /** True when the material itself stresses this topic (e.g. "frequently asked", "important"). */
  statedEmphasis: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
  prerequisites: z.array(text(120)).max(8).default([]),
  /** If this topic matches one of the student's weak-topic hints, that hint verbatim. */
  weakTopicMatch: z.string().trim().max(120).nullish(),
  evidence: z.array(rawEvidenceSchema).min(1).max(5),
});
export type RawTopic = z.infer<typeof rawTopicSchema>;

export const rawSubjectSchema = z.object({
  name: text(120),
  topics: z.array(z.unknown()).max(60),
});

export const rawAnalysisSchema = z.object({
  subjects: z.array(z.unknown()).max(30),
});
