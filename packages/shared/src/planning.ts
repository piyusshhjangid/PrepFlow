import { z } from 'zod';
import { analyzedTopicSchema } from './analysis.js';
import {
  difficultySchema,
  importanceSchema,
  planStatusSchema,
  planTriggerSchema,
  priorityTierSchema,
  taskStatusSchema,
  taskTypeSchema,
} from './enums.js';
import { isoDateSchema } from './setup.js';

/**
 * Contract for study plans and daily execution (Checkpoint D). Everything here is produced by
 * deterministic code: the AI only supplied the topic classification the planner starts from.
 */

export const PLANNING_LIMITS = {
  /** More topics than this is refused rather than planned slowly. */
  maxTopics: 600,
  /** A plan never holds more tasks than this. */
  maxTasks: 6000,
  maxActualMinutes: 720,
} as const;

export const priorityLevelSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type PriorityLevel = z.infer<typeof priorityLevelSchema>;

export const fitStatusSchema = z.enum(['GOOD', 'TIGHT', 'OVER_CAPACITY', 'NO_CAPACITY']);
export type FitStatus = z.infer<typeof fitStatusSchema>;

/** One explained contribution to a topic's priority. `points` is exactly what it added to the score. */
export const priorityReasonSchema = z.object({
  code: z.string(),
  points: z.number(),
  text: z.string(),
});
export type PriorityReason = z.infer<typeof priorityReasonSchema>;

export const priorityComponentsSchema = z.object({
  importance: z.number(),
  emphasis: z.number(),
  weakness: z.number(),
  difficulty: z.number(),
  foundation: z.number(),
  urgency: z.number(),
  evidence: z.number(),
  revision: z.number(),
});
export type PriorityComponents = z.infer<typeof priorityComponentsSchema>;

export const planWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  topicIds: z.array(z.string()).optional(),
});
export type PlanWarning = z.infer<typeof planWarningSchema>;

export const fitReportSchema = z.object({
  status: fitStatusSchema,
  /** One plain-language sentence for the top of the plan page. */
  headline: z.string(),
  daysUntilExam: z.number(),
  studyDays: z.number(),
  /** Every study minute the student said they have between the plan date and the exam. */
  totalMinutes: z.number(),
  /** Held back for delays and recovery; never planned. */
  bufferMinutes: z.number(),
  /** Reserved for revision. */
  revisionReserveMinutes: z.number(),
  /** totalMinutes - bufferMinutes. */
  usableMinutes: z.number(),
  /** Usable time minus the revision reserve: what is left for learning new material. */
  studyCapacityMinutes: z.number(),
  /** Minutes of new learning still needed (all topics, minus work already done). */
  requiredStudyMinutes: z.number(),
  scheduledStudyMinutes: z.number(),
  /** Needed study minutes that did NOT fit and were deferred. */
  deferredStudyMinutes: z.number(),
  revisionScheduledMinutes: z.number(),
  revisionDroppedMinutes: z.number(),
  /** Everything placed on the calendar (study + revision). */
  plannedMinutes: z.number(),
  /** requiredStudyMinutes - studyCapacityMinutes when positive, otherwise 0. */
  capacityGapMinutes: z.number(),
});
export type FitReport = z.infer<typeof fitReportSchema>;

export const tierSummarySchema = z.record(
  priorityTierSchema,
  z.object({ topics: z.number(), minutes: z.number() }),
);
export type TierSummary = z.infer<typeof tierSummarySchema>;

export const topicEvidenceRefSchema = z.object({
  materialName: z.string().nullable(),
  page: z.number().nullable(),
  pageEnd: z.number().nullable(),
});
export type TopicEvidenceRef = z.infer<typeof topicEvidenceRefSchema>;

/** The planner's decision about one topic, with everything needed to explain it. */
export const topicPlanInsightSchema = z.object({
  topicId: z.string(),
  name: z.string(),
  subjectName: z.string(),
  difficulty: difficultySchema,
  importance: importanceSchema,
  isWeak: z.boolean(),
  score: z.number(),
  level: priorityLevelSchema,
  tier: priorityTierSchema,
  components: priorityComponentsSchema,
  reasons: z.array(priorityReasonSchema),
  /** Why the topic is in (or out of) the plan, in one sentence. */
  placement: z.string(),
  estimatedMinutes: z.number(),
  /** Study minutes still needed when the plan was made. */
  requiredMinutes: z.number(),
  scheduledMinutes: z.number(),
  directDependents: z.number(),
  prerequisites: z.array(z.object({ id: z.string(), name: z.string() })),
  evidence: topicEvidenceRefSchema.nullable(),
});
export type TopicPlanInsight = z.infer<typeof topicPlanInsightSchema>;

export const recoveryReportSchema = z.object({
  missedTasks: z.number(),
  missedMinutes: z.number(),
  recoveredMinutes: z.number(),
  /** Part of recoveredMinutes that had to use the daily buffer. */
  usedBufferMinutes: z.number(),
  /** Minutes that could not be placed anywhere. The plan is overloaded by this much. */
  overloadMinutes: z.number(),
  moves: z.array(
    z.object({
      topicName: z.string(),
      type: taskTypeSchema,
      from: z.string(),
      to: z.string(),
      minutes: z.number(),
    }),
  ),
});
export type RecoveryReport = z.infer<typeof recoveryReportSchema>;

export const planSummarySchema = z.object({
  fit: fitReportSchema,
  tiers: tierSummarySchema,
  topics: z.array(topicPlanInsightSchema),
  warnings: z.array(planWarningSchema),
  graph: z.object({
    topics: z.number(),
    edges: z.number(),
    orphans: z.number(),
    cyclesBroken: z.number(),
  }),
  revision: z.object({ scheduled: z.number(), dropped: z.number(), compressed: z.number() }),
  recovery: recoveryReportSchema.nullable(),
});
export type PlanSummary = z.infer<typeof planSummarySchema>;

export const studyTaskViewSchema = z.object({
  id: z.string(),
  topicId: z.string().nullable(),
  topicName: z.string(),
  subjectName: z.string(),
  type: taskTypeSchema,
  revisionIndex: z.number().nullable(),
  partIndex: z.number().nullable(),
  partCount: z.number().nullable(),
  date: z.string(),
  /** Set when recovery moved the task from the day it was first planned. */
  originalDate: z.string().nullable(),
  minutes: z.number(),
  actualMinutes: z.number().nullable(),
  status: taskStatusSchema,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  priorityScore: z.number(),
  level: priorityLevelSchema,
  tier: priorityTierSchema,
  reasons: z.array(z.string()),
  prerequisites: z.array(z.string()),
  evidence: topicEvidenceRefSchema.nullable(),
  /** Still open and dated before the plan's "today". */
  overdue: z.boolean(),
});
export type StudyTaskView = z.infer<typeof studyTaskViewSchema>;

export const topicProgressSchema = z.object({
  topicId: z.string(),
  name: z.string(),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'DEFERRED']),
  studyMinutesPlanned: z.number(),
  studyMinutesCompleted: z.number(),
  revisionsPlanned: z.number(),
  revisionsCompleted: z.number(),
});
export type TopicProgress = z.infer<typeof topicProgressSchema>;

export const planProgressSchema = z.object({
  tasksTotal: z.number(),
  tasksCompleted: z.number(),
  tasksSkipped: z.number(),
  tasksInProgress: z.number(),
  tasksRemaining: z.number(),
  plannedMinutes: z.number(),
  completedMinutes: z.number(),
  remainingMinutes: z.number(),
  skippedMinutes: z.number(),
  overdueTasks: z.number(),
  overdueMinutes: z.number(),
  revisionTotal: z.number(),
  revisionCompleted: z.number(),
  topicsTotal: z.number(),
  topicsCompleted: z.number(),
  topicsDeferred: z.number(),
  /** completedMinutes / plannedMinutes, 0-100. */
  completionPct: z.number(),
});
export type PlanProgress = z.infer<typeof planProgressSchema>;

export const daySummarySchema = z.object({
  date: z.string(),
  /** Minutes the student can plan on that day (total minus buffer); 0 on days off. */
  capacityMinutes: z.number(),
  plannedMinutes: z.number(),
  completedMinutes: z.number(),
  revisionMinutes: z.number(),
  taskCount: z.number(),
});
export type DaySummary = z.infer<typeof daySummarySchema>;

export const planVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  status: planStatusSchema,
  trigger: planTriggerSchema,
  planDate: z.string(),
  createdAt: z.string(),
  archivedReason: z.string().nullable(),
});
export type PlanVersion = z.infer<typeof planVersionSchema>;

export const studyPlanSchema = z.object({
  id: z.string(),
  version: z.number(),
  trigger: planTriggerSchema,
  /** The calendar day the plan was computed for ("today" at that moment). */
  planDate: z.string(),
  createdAt: z.string(),
  examDate: z.string(),
  daysUntilExam: z.number(),
  summary: planSummarySchema,
  progress: planProgressSchema,
  topicProgress: z.array(topicProgressSchema),
  days: z.array(daySummarySchema),
  tasks: z.array(studyTaskViewSchema),
  /** Exam settings changed after this plan was made; rebalancing would apply them. */
  settingsChanged: z.boolean(),
});
export type StudyPlanResponse = z.infer<typeof studyPlanSchema>;

export const getPlanResponseSchema = z.object({
  plan: studyPlanSchema.nullable(),
  /** The date this response treats as "today". */
  today: z.string(),
  /** A plan existed but was archived because the material was re-analyzed. */
  staleReason: z.string().nullable(),
  versions: z.array(planVersionSchema),
});
export type GetPlanResponse = z.infer<typeof getPlanResponseSchema>;

export const todayResponseSchema = z.object({
  date: z.string(),
  hasPlan: z.boolean(),
  examDate: z.string(),
  daysUntilExam: z.number(),
  isStudyDay: z.boolean(),
  /** Minutes available to plan on this day (total minus buffer). */
  capacityMinutes: z.number(),
  plannedMinutes: z.number(),
  completedMinutes: z.number(),
  remainingMinutes: z.number(),
  tasks: z.array(studyTaskViewSchema),
  /** Open tasks from earlier days. */
  overdue: z.array(studyTaskViewSchema),
  overdueMinutes: z.number(),
  /** Revision that is due today or overdue. */
  urgentRevision: z.number(),
  progress: planProgressSchema.nullable(),
  warnings: z.array(planWarningSchema),
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;

export const topicDetailResponseSchema = z.object({
  topic: analyzedTopicSchema,
  subjectName: z.string(),
  insight: topicPlanInsightSchema.nullable(),
  progress: topicProgressSchema.nullable(),
  tasks: z.array(studyTaskViewSchema),
  /** Names of topics that depend on this one. */
  dependents: z.array(z.string()),
});
export type TopicDetailResponse = z.infer<typeof topicDetailResponseSchema>;

// ------------------------------------------------------------------ inputs

/**
 * The browser's calendar date. The server accepts it only within one day of its own UTC date, so a
 * student's local "today" works around midnight without allowing arbitrary dates.
 */
export const generatePlanInputSchema = z.strictObject({
  planDate: isoDateSchema.optional(),
});
export type GeneratePlanInput = z.infer<typeof generatePlanInputSchema>;

export const REBALANCE_MODES = ['RECOVER', 'REPLAN'] as const;
export const rebalanceInputSchema = z.strictObject({
  /**
   * RECOVER: keep the future plan and move only missed tasks into spare time.
   * REPLAN: re-plan everything that is not done yet with the current settings.
   */
  mode: z.enum(REBALANCE_MODES).default('REPLAN'),
  /** REPLAN only: treat skipped study work as still needed. */
  includeSkipped: z.boolean().default(false),
  planDate: isoDateSchema.optional(),
});
export type RebalanceInput = z.infer<typeof rebalanceInputSchema>;

export const todayQuerySchema = z.strictObject({ date: isoDateSchema.optional() });
export type TodayQuery = z.infer<typeof todayQuerySchema>;

export const taskActionInputSchema = z.strictObject({
  /** Optional real time spent, recorded when completing a task. */
  actualMinutes: z.number().int().min(1).max(PLANNING_LIMITS.maxActualMinutes).optional(),
  planDate: isoDateSchema.optional(),
});
export type TaskActionInput = z.infer<typeof taskActionInputSchema>;

export const taskActionResponseSchema = z.object({
  task: studyTaskViewSchema,
  progress: planProgressSchema,
});
export type TaskActionResponse = z.infer<typeof taskActionResponseSchema>;

export const planGenerationResponseSchema = z.object({
  plan: studyPlanSchema,
});
export type PlanGenerationResponse = z.infer<typeof planGenerationResponseSchema>;

/** Priority level thresholds, shared so the UI labels match the server. */
export const PRIORITY_LEVEL_THRESHOLDS = { high: 45, medium: 25 } as const;

export function priorityLevelOf(score: number): PriorityLevel {
  if (score >= PRIORITY_LEVEL_THRESHOLDS.high) return 'HIGH';
  if (score >= PRIORITY_LEVEL_THRESHOLDS.medium) return 'MEDIUM';
  return 'LOW';
}
