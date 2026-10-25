import { z } from 'zod';
import { difficultySchema, importanceSchema, topicOriginSchema } from './enums.js';

/** Shared contract for AI analysis runs and their results (Checkpoint C). */

export const analysisStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED']);
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

/** Real pipeline stages, in order. The UI shows exactly the stage the server reports. */
export const ANALYSIS_STAGES = [
  'LOADING',
  'CHUNKING',
  'ANALYZING',
  'VALIDATING',
  'MERGING',
  'PERSISTING',
  'COMPLETED',
] as const;
export const analysisStageSchema = z.enum(ANALYSIS_STAGES);
export type AnalysisStage = z.infer<typeof analysisStageSchema>;

export const effortClassSchema = z.enum(['QUICK', 'STANDARD', 'EXTENSIVE']);

export const analysisRunSchema = z.object({
  id: z.string(),
  examId: z.string(),
  status: analysisStatusSchema,
  stage: analysisStageSchema.nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  materialCount: z.number(),
  totalChunks: z.number(),
  processedChunks: z.number(),
  failedChunks: z.number(),
  topicCount: z.number(),
  droppedTopics: z.number(),
  warnings: z.array(z.string()),
  /** Stable machine-readable code and a safe message, set when status is FAILED. */
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  latencyMs: z.number().nullable(),
});
export type AnalysisRunSummary = z.infer<typeof analysisRunSchema>;

export const startAnalysisResponseSchema = z.object({
  run: analysisRunSchema,
  /** The identical analysis already succeeded; no new AI calls were made. */
  reused: z.boolean(),
  /** An analysis for this exam was already queued or running; that run is returned. */
  alreadyRunning: z.boolean(),
});
export type StartAnalysisResponse = z.infer<typeof startAnalysisResponseSchema>;

export const latestAnalysisResponseSchema = z.object({ run: analysisRunSchema.nullable() });
export type LatestAnalysisResponse = z.infer<typeof latestAnalysisResponseSchema>;

export const topicEvidenceSchema = z.object({
  materialId: z.string(),
  /** Display name of the material (filename, or null for pasted text). */
  materialName: z.string().nullable(),
  /** 1-based physical PDF page, or null for pasted text. Always derived by the server. */
  page: z.number().nullable(),
  pageEnd: z.number().nullable(),
  /** Canonical text from the source material. */
  snippet: z.string(),
  /** Advisory link between the topic name and quote; absent on evidence saved by older versions. */
  support: z.enum(['direct', 'nearby', 'weak']).optional(),
  /** Verbatim source sentence that explicitly signals exam importance. */
  importanceCue: z.string().max(200).optional(),
});
export type TopicEvidence = z.infer<typeof topicEvidenceSchema>;

export const analyzedTopicSchema = z.object({
  id: z.string(),
  name: z.string(),
  parent: z.string().nullable(),
  description: z.string(),
  difficulty: difficultySchema,
  importance: importanceSchema,
  effort: effortClassSchema,
  /** Computed by code from the model's classification. */
  estimatedMinutes: z.number(),
  revisionWeight: z.number(),
  origin: topicOriginSchema,
  statedEmphasis: z.boolean(),
  confidence: z.number(),
  isWeak: z.boolean(),
  weakHint: z.string().nullable(),
  prerequisites: z.array(z.string()),
  evidence: z.array(topicEvidenceSchema),
});
export type AnalyzedTopic = z.infer<typeof analyzedTopicSchema>;

export const analyzedSubjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  topics: z.array(analyzedTopicSchema),
});
export type AnalyzedSubject = z.infer<typeof analyzedSubjectSchema>;

export const analysisResultResponseSchema = z.object({
  /** The run that produced `subjects`; null when the exam has not been analyzed yet. */
  run: analysisRunSchema.nullable(),
  subjects: z.array(analyzedSubjectSchema),
  totalEstimatedMinutes: z.number(),
});
export type AnalysisResultResponse = z.infer<typeof analysisResultResponseSchema>;

/** Student-controlled fields on an analyzed topic. Names and AI evidence stay immutable. */
export const reviewTopicInputSchema = z
  .strictObject({
    estimatedMinutes: z.number().int().min(5).max(1440).multipleOf(5).optional(),
    importance: importanceSchema.optional(),
    isWeak: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Choose at least one topic field to update.');
export type ReviewTopicInput = z.infer<typeof reviewTopicInputSchema>;
