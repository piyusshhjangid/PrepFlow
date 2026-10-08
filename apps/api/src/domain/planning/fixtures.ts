import type { HistoryTask, PlanConfig, PlanTopic } from './types.js';

/** Test helpers: build topics and configs with sensible defaults. 2026-10-05 is a Monday. */
export function topic(id: string, overrides: Partial<PlanTopic> = {}): PlanTopic {
  return {
    id,
    name: overrides.name ?? id.toUpperCase(),
    subjectId: 's1',
    subjectName: 'Subject',
    order: 0,
    difficulty: 'MEDIUM',
    importance: 'MEDIUM',
    estimatedMinutes: 60,
    revisionWeight: 0.5,
    statedEmphasis: false,
    confidence: 0.8,
    isWeak: false,
    prerequisiteIds: [],
    evidenceCount: 1,
    evidence: { materialName: 'notes.pdf', page: 3, pageEnd: 3 },
    ...overrides,
  };
}

/** Topics a, b, c... in document order with the given overrides per id. */
export function topics(spec: Record<string, Partial<PlanTopic>>): PlanTopic[] {
  return Object.entries(spec).map(([id, o], order) => topic(id, { order, ...o }));
}

export function config(overrides: Partial<PlanConfig> = {}): PlanConfig {
  return {
    today: '2026-10-05',
    examDate: '2026-10-15',
    minutesPerDay: 180,
    studyWeekdays: [0, 1, 2, 3, 4, 5, 6],
    blockedDates: [],
    bufferPct: 10,
    revisionReservePct: 15,
    revisionIntervalsDays: [1, 3, 7],
    learnerConfidence: null,
    ...overrides,
  };
}

let seq = 0;
export function historyTask(overrides: Partial<HistoryTask>): HistoryTask {
  seq += 1;
  return {
    id: `h${seq}`,
    topicId: 'a',
    topicName: 'A',
    subjectName: 'Subject',
    type: 'STUDY',
    revisionIndex: null,
    partIndex: null,
    partCount: null,
    date: '2026-10-05',
    originalDate: null,
    minutes: 60,
    actualMinutes: null,
    sortOrder: 0,
    status: 'PENDING',
    startedAt: null,
    completedAt: null,
    priorityScore: 50,
    tier: 'MUST',
    reasons: [],
    carriedFromTaskId: null,
    ...overrides,
  };
}
