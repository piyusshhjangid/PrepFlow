import type { SourceKind } from '../domain/documents/pages.js';

/**
 * Persistence ports. Services depend on these narrow interfaces, never on Prisma directly, so the
 * business rules are tested with in-memory fakes and the Prisma code stays a thin mapping layer.
 */

export interface ExamRecord {
  id: string;
  profileId: string;
  nickname: string;
  name: string;
  /** Calendar date at UTC midnight. */
  examDate: Date;
  minutesPerDay: number;
  studyDays: number[];
  weakTopicHints: string[];
  confidence: number | null;
  revisionIntervalsDays: number[];
  revisionReservePct: number;
  /** Share (0-30) of every study day held back for delays and recovery. */
  bufferPct: number;
  /** Specific days off, at UTC midnight. */
  blockedDates: Date[];
}

export interface NewExam {
  nickname: string;
  name: string;
  examDate: Date;
  minutesPerDay: number;
  studyDays: number[];
  weakTopicHints: string[];
  confidence: number | null;
  bufferPct: number;
  blockedDates: Date[];
}

/** Only provided keys change; `confidence: null` clears it. */
export interface ExamPatch {
  name?: string;
  examDate?: Date;
  minutesPerDay?: number;
  studyDays?: number[];
  weakTopicHints?: string[];
  confidence?: number | null;
  bufferPct?: number;
  blockedDates?: Date[];
}

export interface SetupRepository {
  createProfileWithExam(data: NewExam): Promise<ExamRecord>;
  findExam(examId: string): Promise<ExamRecord | null>;
  /** Returns null when the exam doesn't exist. */
  updateExam(examId: string, patch: ExamPatch): Promise<ExamRecord | null>;
}

/** A material without its (large) text. */
export interface MaterialRecord {
  id: string;
  examId: string;
  sourceType: SourceKind;
  filename: string | null;
  charCount: number;
  pageCount: number | null;
  lowTextPageCount: number | null;
  createdAt: Date;
}

export interface NewMaterial {
  examId: string;
  sourceType: SourceKind;
  filename: string | null;
  contentHash: string;
  /** Pages serialized with pages.ts. */
  extractedText: string;
  charCount: number;
  pageCount: number | null;
  lowTextPageCount: number | null;
}

export interface MaterialRepository {
  countByExam(examId: string): Promise<number>;
  listByExam(examId: string): Promise<MaterialRecord[]>;
  findByHash(examId: string, contentHash: string): Promise<MaterialRecord | null>;
  /**
   * Inserts the material unless identical content already exists for the exam
   * (unique on examId + contentHash), in which case the existing one is returned with created = false.
   * Safe under concurrent identical uploads.
   */
  createIfAbsent(data: NewMaterial): Promise<{ material: MaterialRecord; created: boolean }>;
  /** True when a row was deleted. */
  delete(materialId: string): Promise<boolean>;
}

// ------------------------------------------------------------------ analysis (Checkpoint C)

export type AnalysisStatusValue = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
export type AnalysisStageValue =
  'LOADING' | 'CHUNKING' | 'ANALYZING' | 'VALIDATING' | 'MERGING' | 'PERSISTING' | 'COMPLETED';

export interface AnalysisRunRecord {
  id: string;
  examId: string;
  status: AnalysisStatusValue;
  stage: AnalysisStageValue | null;
  fingerprint: string;
  provider: string | null;
  model: string | null;
  materialCount: number;
  totalChunks: number;
  processedChunks: number;
  failedChunks: number;
  topicCount: number;
  droppedTopics: number;
  warnings: string[];
  startedAt: Date | null;
  finishedAt: Date | null;
  heartbeatAt: Date | null;
  latencyMs: number | null;
  retryCount: number;
  validationFailures: number;
  promptTokens: number | null;
  completionTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

export type AnalysisRunPatch = Partial<
  Omit<AnalysisRunRecord, 'id' | 'examId' | 'fingerprint' | 'createdAt'>
>;

/** A material including its text, for analysis only. */
export interface AnalysisMaterial {
  id: string;
  contentHash: string;
  sourceType: SourceKind;
  filename: string | null;
  extractedText: string;
}

export interface PersistedTopic {
  name: string;
  parent: string | null;
  description: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
  effortClass: 'QUICK' | 'STANDARD' | 'EXTENSIVE';
  revisionWeight: number;
  estimatedMinutes: number;
  origin: 'EXTRACTED' | 'INFERRED';
  statedEmphasis: boolean;
  confidence: number;
  prerequisites: string[];
  isWeak: boolean;
  weakHint: string | null;
  evidence: {
    materialId: string;
    chunkId: string;
    page: number | null;
    pageEnd: number | null;
    snippet: string;
  }[];
}

export interface PersistedSubject {
  name: string;
  topics: PersistedTopic[];
}

export interface StoredTopic extends PersistedTopic {
  id: string;
  subjectId: string;
  parentId: string | null;
  prerequisiteIds: string[];
}

export interface StoredSubject {
  id: string;
  name: string;
  topics: StoredTopic[];
}

export interface AnalysisRepository {
  loadMaterials(examId: string): Promise<AnalysisMaterial[]>;
  /**
   * Atomically creates a QUEUED run unless the exam already has a QUEUED/RUNNING one, in which case
   * that run is returned with created = false. Safe under concurrent requests.
   */
  createRunIfNoActive(data: {
    examId: string;
    fingerprint: string;
    provider: string;
    model: string;
    materialCount: number;
  }): Promise<{ run: AnalysisRunRecord; created: boolean }>;
  updateRun(runId: string, patch: AnalysisRunPatch): Promise<AnalysisRunRecord | null>;
  findRun(runId: string): Promise<AnalysisRunRecord | null>;
  findLatestRun(examId: string): Promise<AnalysisRunRecord | null>;
  /** The run whose topics are currently stored for the exam (latest SUCCEEDED/PARTIAL). */
  findCurrentResultRun(examId: string): Promise<AnalysisRunRecord | null>;
  /**
   * Replaces the exam's subjects/topics with the result and finalizes the run, in ONE transaction:
   * either everything is saved or nothing is.
   */
  saveResult(
    runId: string,
    examId: string,
    subjects: PersistedSubject[],
    finalPatch: AnalysisRunPatch,
  ): Promise<void>;
  loadResult(examId: string): Promise<StoredSubject[]>;
  updateReviewedTopic(
    examId: string,
    topicId: string,
    patch: { estimatedMinutes?: number; importance?: 'LOW' | 'MEDIUM' | 'HIGH'; isWeak?: boolean },
  ): Promise<boolean>;
  deleteReviewedTopic(examId: string, topicId: string): Promise<boolean>;
  /** Marks QUEUED/RUNNING runs (older than `olderThan` if given) as FAILED. Returns how many. */
  failActiveRuns(
    olderThan: Date | null,
    error: { code: string; message: string },
    now: Date,
  ): Promise<number>;
}

// ------------------------------------------------------------------ planning (Checkpoint D)

export type TaskTypeValue = 'STUDY' | 'REVISION';
export type TaskStatusValue = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
export type PriorityTierValue = 'MUST' | 'SHOULD' | 'IF_TIME' | 'DEFER';
export type PlanTriggerValue = 'GENERATE' | 'RECOVER_MISSED' | 'REPLAN_REMAINING';

export interface PlanRecord {
  id: string;
  examId: string;
  version: number;
  status: 'ACTIVE' | 'ARCHIVED';
  trigger: PlanTriggerValue;
  planDate: Date;
  basedOnAnalysisRunId: string | null;
  availableMinutes: number;
  requiredMinutes: number;
  scheduledMinutes: number;
  /** The planner settings used (JSON). Validated by the service before use. */
  config: unknown;
  /** Fit report, per-topic breakdown, warnings (JSON). Validated by the service before use. */
  summary: unknown;
  archivedReason: string | null;
  createdAt: Date;
}

export interface TaskRecord {
  id: string;
  planId: string;
  topicId: string | null;
  topicName: string;
  subjectName: string;
  type: TaskTypeValue;
  revisionIndex: number | null;
  partIndex: number | null;
  partCount: number | null;
  scheduledDate: Date;
  originalDate: Date | null;
  plannedMinutes: number;
  actualMinutes: number | null;
  sortOrder: number;
  status: TaskStatusValue;
  startedAt: Date | null;
  completedAt: Date | null;
  priorityScore: number;
  tier: PriorityTierValue;
  reasons: string[];
  carriedFromTaskId: string | null;
}

export type NewTask = Omit<TaskRecord, 'id' | 'planId'>;

export interface NewPlan {
  trigger: PlanTriggerValue;
  planDate: Date;
  basedOnAnalysisRunId: string | null;
  availableMinutes: number;
  requiredMinutes: number;
  scheduledMinutes: number;
  config: unknown;
  summary: unknown;
  tasks: NewTask[];
}

export interface PlanWithTasks {
  plan: PlanRecord;
  tasks: TaskRecord[];
}

/** Only provided keys change. */
export interface TaskPatch {
  status?: TaskStatusValue;
  startedAt?: Date | null;
  completedAt?: Date | null;
  actualMinutes?: number | null;
}

export interface PlanRepository {
  findActive(examId: string): Promise<PlanWithTasks | null>;
  /** The newest plan of any status, without tasks (used to explain why there is no active plan). */
  findLatest(examId: string): Promise<PlanRecord | null>;
  listVersions(examId: string): Promise<PlanRecord[]>;
  /** Display names of the exam's materials, for evidence references (never their text). */
  materialNames(examId: string): Promise<Map<string, string | null>>;
  /**
   * Creates the next plan version and archives the current one, in ONE transaction that also holds
   * a per-exam lock, so task updates and other rebalances cannot interleave. `build` receives the
   * current plan and its tasks as they are inside the lock and returns the new plan; it may throw to
   * abort. `reason` is stored on the archived plan.
   */
  replaceActive(
    examId: string,
    reason: string,
    build: (current: PlanWithTasks | null) => NewPlan,
  ): Promise<PlanWithTasks>;
  /**
   * Updates one task of an ACTIVE plan under the same per-exam lock. `decide` sees the current rows and
   * returns the patch, or null for "nothing to change"; it may throw to reject. Returns null when the
   * task does not exist. `activePlan` is false when the task belongs to an archived plan (nothing is changed).
   */
  mutateTask(
    taskId: string,
    decide: (task: TaskRecord, plan: PlanRecord) => TaskPatch | null,
  ): Promise<{ task: TaskRecord; plan: PlanRecord; changed: boolean; activePlan: boolean } | null>;
  /** Tasks of the exam's ACTIVE plan; used for per-topic views. */
  findTask(taskId: string): Promise<{ task: TaskRecord; plan: PlanRecord } | null>;
}
