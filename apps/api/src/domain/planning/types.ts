import type {
  Difficulty,
  Importance,
  PlanWarning,
  PriorityTier,
  TaskStatus,
  TaskType,
  TopicEvidenceRef,
} from '@prepflow/shared';

/**
 * Types for the deterministic planning engine. Nothing in src/domain/planning touches the
 * database, the clock, the network or an AI model: the same inputs always give the same plan.
 */

/** A topic as the planner sees it: the analysis result flattened to plain data. */
export interface PlanTopic {
  id: string;
  name: string;
  subjectId: string;
  subjectName: string;
  /**
   * Position in the analysis result (subject order, then topic order, i.e. roughly the order the
   * material presents things). Used for tie-breaking and cycle repair only.
   */
  order: number;
  difficulty: Difficulty;
  importance: Importance;
  /** Minutes of first-time study, computed by Checkpoint C's deterministic estimator. */
  estimatedMinutes: number;
  /** 0-1: how much revision the topic needs. */
  revisionWeight: number;
  statedEmphasis: boolean;
  /** 0-1 model confidence that this is a real, distinct topic. */
  confidence: number;
  isWeak: boolean;
  prerequisiteIds: string[];
  evidenceCount: number;
  /** First evidence location, copied into plan tasks so they can point back at the material. */
  evidence: TopicEvidenceRef | null;
}

export interface PlanConfig {
  /** The planning date ("today"), supplied by the caller. The engine never reads the clock. */
  today: string;
  examDate: string;
  minutesPerDay: number;
  /** 0 = Sunday ... 6 = Saturday. */
  studyWeekdays: number[];
  /** Specific days off (YYYY-MM-DD). */
  blockedDates: string[];
  /** Share of each day held back and never planned (0-50). */
  bufferPct: number;
  /** Share of each day reserved for revision (0-50). */
  revisionReservePct: number;
  /** Days after finishing a topic at which it is revised, ascending, e.g. [1, 3, 7]. */
  revisionIntervalsDays: number[];
  /** The student's self-reported confidence 1 (low) - 5 (high); null when not given. */
  learnerConfidence: number | null;
}

/** A task as the planner produces it (no id yet). */
export interface TaskDraft {
  topicId: string | null;
  topicName: string;
  subjectName: string;
  type: TaskType;
  revisionIndex: number | null;
  partIndex: number | null;
  partCount: number | null;
  date: string;
  originalDate: string | null;
  minutes: number;
  actualMinutes: number | null;
  sortOrder: number;
  status: TaskStatus;
  startedAt: string | null;
  completedAt: string | null;
  priorityScore: number;
  tier: PriorityTier;
  reasons: string[];
  /** The task of the previous plan version this one was copied from, if any. */
  carriedFromTaskId: string | null;
}

/** A task that already exists in a stored plan. */
export interface HistoryTask extends TaskDraft {
  id: string;
}

export interface DayCapacity {
  date: string;
  /** What the student said they can study this day. */
  total: number;
  /** Held back for delays and recovery. */
  buffer: number;
  /** total - buffer: the most the planner will schedule. */
  usable: number;
  /** Part of `usable` reserved for revision. */
  revisionReserve: number;
  /** usable - revisionReserve: what new learning is guaranteed. */
  studyCapacity: number;
}

export type { PlanWarning };

/** Thrown for input the engine cannot plan from (bad dates, negative minutes...). */
export class PlanningInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PlanningInputError';
  }
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}
