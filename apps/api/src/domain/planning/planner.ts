import {
  priorityLevelOf,
  type FitReport,
  type FitStatus,
  type PlanSummary,
  type PlanWarning,
  type PriorityTier,
  type TierSummary,
  type TopicPlanInsight,
} from '@prepflow/shared';
import { diffDaysIso } from '@prepflow/shared';
import { assertValidConfig, buildCalendar, totalsOf } from './capacity.js';
import { PLAN_TUNING } from './config.js';
import { buildDependencyGraph, topologicalOrder } from './graph.js';
import { computePriority, type PriorityResult } from './priority.js';
import { runSchedule, type SchedTopic } from './scheduler.js';
import { assignTiers } from './tiers.js';
import {
  formatMinutes,
  PlanningInputError,
  type HistoryTask,
  type PlanConfig,
  type PlanTopic,
  type TaskDraft,
} from './types.js';

export interface GenerateInput {
  topics: readonly PlanTopic[];
  config: PlanConfig;
  /**
   * Tasks of the plan being replaced. Finished, skipped and started tasks are carried forward
   * unchanged; open tasks are re-planned. Omit for a first plan.
   */
  history?: readonly HistoryTask[];
  /** Treat skipped study work as still needed. */
  includeSkipped?: boolean;
}

export interface GenerateOutput {
  tasks: TaskDraft[];
  summary: PlanSummary;
}

const G = PLAN_TUNING.granularity;

function assertValidTopics(topics: readonly PlanTopic[]): void {
  if (topics.length > PLAN_TUNING.maxTopics)
    throw new PlanningInputError(
      'TOO_MANY_TOPICS',
      `A plan can hold at most ${PLAN_TUNING.maxTopics} topics.`,
    );
  const seen = new Set<string>();
  for (const t of topics) {
    if (seen.has(t.id)) throw new PlanningInputError('DUPLICATE_TOPIC', 'Two topics share an id.');
    seen.add(t.id);
    if (
      !Number.isInteger(t.estimatedMinutes) ||
      t.estimatedMinutes < 0 ||
      t.estimatedMinutes > 1440
    )
      throw new PlanningInputError(
        'INVALID_EFFORT',
        `Topic "${t.name}" has an impossible study time.`,
      );
    if (![t.revisionWeight, t.confidence].every(Number.isFinite))
      throw new PlanningInputError('INVALID_TOPIC', `Topic "${t.name}" has invalid values.`);
  }
}

interface Work {
  remaining: Map<string, number>;
  studiedOn: Map<string, string>;
  revisionDone: Map<string, number>;
  preserved: HistoryTask[];
  prefilled: Map<string, number>;
}

/** What is already done, and so what is left to plan. A first plan has no history. */
function deriveWork(
  topics: readonly PlanTopic[],
  history: readonly HistoryTask[],
  today: string,
  includeSkipped: boolean,
): Work {
  const known = new Set(topics.map((t) => t.id));
  const covered = new Map<string, number>();
  const skipped = new Map<string, number>();
  const studiedOn = new Map<string, string>();
  const revisionDone = new Map<string, number>();
  const prefilled = new Map<string, number>();
  const preserved = history
    .filter((t) => t.status !== 'PENDING')
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
    );

  for (const t of preserved) {
    if (t.status === 'COMPLETED' || t.status === 'IN_PROGRESS') {
      if (t.date >= today) prefilled.set(t.date, (prefilled.get(t.date) ?? 0) + t.minutes);
    }
    if (t.topicId === null || !known.has(t.topicId)) continue;
    if (t.type === 'STUDY') {
      if (t.status === 'SKIPPED') skipped.set(t.topicId, (skipped.get(t.topicId) ?? 0) + t.minutes);
      else {
        covered.set(t.topicId, (covered.get(t.topicId) ?? 0) + t.minutes);
        const previous = studiedOn.get(t.topicId);
        if (previous === undefined || t.date > previous) studiedOn.set(t.topicId, t.date);
      }
    } else {
      revisionDone.set(t.topicId, (revisionDone.get(t.topicId) ?? 0) + 1);
    }
  }
  const remaining = new Map<string, number>();
  for (const t of topics) {
    const done = (covered.get(t.id) ?? 0) + (includeSkipped ? 0 : (skipped.get(t.id) ?? 0));
    remaining.set(t.id, Math.max(0, t.estimatedMinutes - done));
  }
  // A topic only counts as "studied on" a day when all of its (non-skipped) work is covered.
  for (const t of topics) if ((remaining.get(t.id) as number) > 0) studiedOn.delete(t.id);
  return { remaining, studiedOn, revisionDone, preserved: [...preserved], prefilled };
}

const toDraft = (t: HistoryTask): TaskDraft => ({
  topicId: t.topicId,
  topicName: t.topicName,
  subjectName: t.subjectName,
  type: t.type,
  revisionIndex: t.revisionIndex,
  partIndex: t.partIndex,
  partCount: t.partCount,
  date: t.date,
  originalDate: t.originalDate,
  minutes: t.minutes,
  actualMinutes: t.actualMinutes,
  sortOrder: t.sortOrder,
  status: t.status,
  startedAt: t.startedAt,
  completedAt: t.completedAt,
  priorityScore: t.priorityScore,
  tier: t.tier,
  reasons: t.reasons,
  carriedFromTaskId: t.id,
});

/** Orders the study tasks of every topic and numbers them "part i of n" (only when n > 1). */
export function numberParts(tasks: TaskDraft[]): void {
  const byTopic = new Map<string, TaskDraft[]>();
  for (const t of tasks) {
    if (t.type !== 'STUDY' || t.topicId === null) continue;
    const list = byTopic.get(t.topicId) ?? [];
    list.push(t);
    byTopic.set(t.topicId, list);
  }
  for (const list of byTopic.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.sortOrder - b.sortOrder);
    list.forEach((t, i) => {
      t.partIndex = list.length > 1 ? i + 1 : null;
      t.partCount = list.length > 1 ? list.length : null;
    });
  }
}

/** Gives every day's tasks a clean 0..n-1 order and sorts the list by date. */
export function orderTasks(tasks: TaskDraft[], bucket: (t: TaskDraft) => number): TaskDraft[] {
  const sorted = [...tasks].sort(
    (a, b) => a.date.localeCompare(b.date) || bucket(a) - bucket(b) || a.sortOrder - b.sortOrder,
  );
  const counters = new Map<string, number>();
  for (const t of sorted) {
    const n = counters.get(t.date) ?? 0;
    t.sortOrder = n;
    counters.set(t.date, n + 1);
  }
  return sorted;
}

export function generatePlan(input: GenerateInput): GenerateOutput {
  const { config } = input;
  const topics = [...input.topics].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  assertValidConfig(config);
  assertValidTopics(topics);

  const daysToExam = diffDaysIso(config.today, config.examDate);
  const daysUntilExam = Math.max(0, daysToExam);
  const calendar = buildCalendar(config);
  const totals = totalsOf(calendar);
  const graph = buildDependencyGraph(topics);
  const byId = new Map(topics.map((t) => [t.id, t]));
  const nameOf = (id: string) => (byId.get(id) as PlanTopic).name;

  // ---- 1. priority (deterministic; the model contributed only the classification)
  const priority = new Map<string, PriorityResult>();
  for (const t of topics) {
    priority.set(
      t.id,
      computePriority(t, {
        daysUntilExam,
        learnerConfidence: config.learnerConfidence,
        directDependents: graph.directDependents.get(t.id) as number,
        transitiveDependents: graph.transitiveDependents.get(t.id) as number,
      }),
    );
  }
  const score = (id: string) => (priority.get(id) as PriorityResult).score;
  const rankCompare = (a: string, b: string) =>
    score(b) - score(a) ||
    (graph.directDependents.get(b) as number) - (graph.directDependents.get(a) as number) ||
    (graph.depth.get(a) as number) - (graph.depth.get(b) as number) ||
    (byId.get(a) as PlanTopic).order - (byId.get(b) as PlanTopic).order ||
    a.localeCompare(b);
  const ranked = [...graph.ids].sort(rankCompare);

  // Prerequisites inherit the urgency of what depends on them, so they are not stuck behind it.
  const effScore = new Map<string, number>();
  for (const id of [...topologicalOrder(graph, rankCompare)].reverse()) {
    let best = score(id);
    for (const d of graph.dependents.get(id) as string[])
      best = Math.max(best, (effScore.get(d) as number) - 1);
    effScore.set(id, best);
  }

  // ---- 2. what is already done, what is left
  const work = deriveWork(topics, input.history ?? [], config.today, input.includeSkipped ?? false);
  const requiredStudy = [...work.remaining.values()].reduce((a, b) => a + b, 0);

  // ---- 3. tiers against the capacity that is really left
  const studyCapacity = calendar.reduce(
    (acc, d) => acc + Math.max(0, d.studyCapacity - (work.prefilled.get(d.date) ?? 0)),
    0,
  );
  const { tiers, includedFor } = assignTiers({
    ranked,
    minutes: work.remaining,
    graph,
    studyCapacityMinutes: studyCapacity,
  });

  // ---- 4. schedule everything that is not deferred
  const schedTopics: SchedTopic[] = topics
    .filter((t) => tiers.get(t.id) !== 'DEFER')
    .map((t) => ({
      id: t.id,
      name: t.name,
      tier: tiers.get(t.id) as Exclude<PriorityTier, 'DEFER'>,
      score: score(t.id),
      effScore: effScore.get(t.id) as number,
      depth: graph.depth.get(t.id) as number,
      order: t.order,
      remaining: work.remaining.get(t.id) as number,
      estimated: t.estimatedMinutes,
      revisionWeight: t.revisionWeight,
      prereqs: (graph.prerequisites.get(t.id) as string[]).filter((p) => tiers.get(p) !== 'DEFER'),
      studiedOn: work.studiedOn.get(t.id) ?? null,
      revisionDone: work.revisionDone.get(t.id) ?? 0,
    }));
  const scheduled = runSchedule({
    calendar,
    topics: schedTopics,
    today: config.today,
    intervals: config.revisionIntervalsDays,
    prefilled: work.prefilled,
  });

  // ---- 5. build task rows
  const scheduledStudy = new Map<string, number>();
  const newTasks: TaskDraft[] = scheduled.tasks.map((s) => {
    const topic = byId.get(s.topicId) as PlanTopic;
    const p = priority.get(s.topicId) as PriorityResult;
    if (s.type === 'STUDY')
      scheduledStudy.set(s.topicId, (scheduledStudy.get(s.topicId) ?? 0) + s.minutes);
    const reasons =
      s.type === 'STUDY'
        ? p.reasons.slice(0, 3).map((r) => r.text)
        : [
            s.compressed
              ? 'Final review: the exam is too close for the usual spacing'
              : `Review ${s.revisionIndex}: spaced revision after you studied this`,
            ...p.reasons.slice(0, 1).map((r) => r.text),
          ];
    const includedBy = includedFor.get(s.topicId);
    if (s.type === 'STUDY' && includedBy !== undefined)
      reasons.push(`Needed first: ${nameOf(includedBy)} builds on it`);
    return {
      topicId: topic.id,
      topicName: topic.name,
      subjectName: topic.subjectName,
      type: s.type,
      revisionIndex: s.revisionIndex,
      partIndex: null,
      partCount: null,
      date: s.date,
      originalDate: null,
      minutes: s.minutes,
      actualMinutes: null,
      sortOrder: s.seq,
      status: 'PENDING',
      startedAt: null,
      completedAt: null,
      priorityScore: p.score,
      tier: tiers.get(s.topicId) as PriorityTier,
      reasons,
      carriedFromTaskId: null,
    };
  });
  const kept = work.preserved.map(toDraft);
  const keptIds = new Set(kept);
  const all = orderTasks([...kept, ...newTasks], (t) =>
    keptIds.has(t) ? 0 : t.type === 'REVISION' ? 1 : 2,
  );
  numberParts(all);

  // ---- 6. the fit report, tiers, insights and warnings
  const scheduledStudyMinutes = [...scheduledStudy.values()].reduce((a, b) => a + b, 0);
  const revisionScheduled = newTasks
    .filter((t) => t.type === 'REVISION')
    .reduce((a, t) => a + t.minutes, 0);
  const revisionDropped = scheduled.droppedRevisions.reduce((a, r) => a + r.minutes, 0);
  const deferredStudy = requiredStudy - scheduledStudyMinutes;
  const gap = Math.max(0, requiredStudy - studyCapacity);

  let status: FitStatus;
  if (requiredStudy > 0 && totals.usableMinutes === 0) status = 'NO_CAPACITY';
  else if (deferredStudy > 0) status = 'OVER_CAPACITY';
  else if (requiredStudy > studyCapacity * PLAN_TUNING.tightShare || revisionDropped > 0)
    status = 'TIGHT';
  else status = 'GOOD';

  const deferredTopics = topics.filter((t) => {
    const need = work.remaining.get(t.id) as number;
    return need > 0 && (scheduledStudy.get(t.id) ?? 0) < need;
  });
  const headline = (() => {
    if (topics.length === 0) return 'There are no topics to plan yet.';
    if (status === 'NO_CAPACITY')
      return daysToExam <= 0
        ? 'The exam is today or has passed, so there is no study time left to plan.'
        : 'There are no study days before the exam with your current settings, so nothing can be scheduled.';
    if (status === 'OVER_CAPACITY')
      return `The complete syllabus does not fit into your available study time. You need ${formatMinutes(requiredStudy)} for new material but have ${formatMinutes(studyCapacity)}. PrepFlow protected the highest-priority topics and deferred ${deferredTopics.length} lower-priority ${deferredTopics.length === 1 ? 'topic' : 'topics'}.`;
    if (status === 'TIGHT')
      return `Everything fits, but with little room to spare: ${formatMinutes(requiredStudy)} of new material in ${formatMinutes(studyCapacity)} of study capacity.`;
    return `Your syllabus fits: ${formatMinutes(requiredStudy)} of new material plus revision in ${formatMinutes(totals.totalMinutes)} of available time.`;
  })();

  const fit: FitReport = {
    status,
    headline,
    daysUntilExam,
    studyDays: totals.studyDays,
    totalMinutes: totals.totalMinutes,
    bufferMinutes: totals.bufferMinutes,
    revisionReserveMinutes: totals.revisionReserveMinutes,
    usableMinutes: totals.usableMinutes,
    studyCapacityMinutes: totals.studyCapacityMinutes,
    requiredStudyMinutes: requiredStudy,
    scheduledStudyMinutes,
    deferredStudyMinutes: deferredStudy,
    revisionScheduledMinutes: revisionScheduled,
    revisionDroppedMinutes: revisionDropped,
    plannedMinutes: scheduledStudyMinutes + revisionScheduled,
    capacityGapMinutes: gap,
  };

  const tierSummary: TierSummary = {
    MUST: { topics: 0, minutes: 0 },
    SHOULD: { topics: 0, minutes: 0 },
    IF_TIME: { topics: 0, minutes: 0 },
    DEFER: { topics: 0, minutes: 0 },
  };
  const finalTier = (id: string): PriorityTier => {
    const need = work.remaining.get(id) as number;
    return need > 0 && (scheduledStudy.get(id) ?? 0) < need
      ? 'DEFER'
      : (tiers.get(id) as PriorityTier);
  };
  for (const t of topics) {
    const entry = tierSummary[finalTier(t.id)] as { topics: number; minutes: number };
    entry.topics += 1;
    entry.minutes += work.remaining.get(t.id) as number;
  }

  const insights: TopicPlanInsight[] = ranked.map((id) => {
    const t = byId.get(id) as PlanTopic;
    const p = priority.get(id) as PriorityResult;
    const need = work.remaining.get(id) as number;
    const placed = scheduledStudy.get(id) ?? 0;
    const tier = finalTier(id);
    let placement: string;
    if (need === 0) placement = 'Nothing left to study here; only revision remains.';
    else if (tier === 'DEFER')
      placement =
        totals.usableMinutes === 0
          ? 'Not scheduled: there are no study days before the exam.'
          : placed > 0
            ? `Only ${formatMinutes(placed)} of the ${formatMinutes(need)} needed fit before the exam.`
            : `Deferred: it needs ${formatMinutes(need)} and does not fit in your study capacity after higher-priority topics.`;
    else if (includedFor.has(id))
      placement = `Scheduled early because ${nameOf(includedFor.get(id) as string)} depends on it.`;
    else if (tier === 'MUST')
      placement = 'Core topic: scheduled first and protected if time gets short.';
    else if (tier === 'SHOULD') placement = 'Scheduled; fits in your study time.';
    else placement = 'Scheduled last; the first topic to drop if time gets shorter.';
    return {
      topicId: id,
      name: t.name,
      subjectName: t.subjectName,
      difficulty: t.difficulty,
      importance: t.importance,
      isWeak: t.isWeak,
      score: p.score,
      level: priorityLevelOf(p.score),
      tier,
      components: p.components,
      reasons: p.reasons,
      placement,
      estimatedMinutes: t.estimatedMinutes,
      requiredMinutes: need,
      scheduledMinutes: placed,
      directDependents: graph.directDependents.get(id) as number,
      prerequisites: (graph.prerequisites.get(id) as string[]).map((pid) => ({
        id: pid,
        name: nameOf(pid),
      })),
      evidence: t.evidence,
    };
  });

  const warnings: PlanWarning[] = [];
  if (topics.length === 0)
    warnings.push({ code: 'NO_TOPICS', message: 'There are no topics to plan yet.' });
  if (daysToExam < 0)
    warnings.push({
      code: 'EXAM_PASSED',
      message: 'The exam date has already passed, so nothing can be scheduled.',
    });
  else if (daysToExam === 0)
    warnings.push({
      code: 'EXAM_TODAY',
      message: 'The exam is today. Study time ends before it starts, so nothing is scheduled.',
    });
  else if (calendar.length === 0)
    warnings.push({
      code: 'NO_STUDY_DAYS',
      message: 'None of the days before the exam are study days with your settings.',
    });
  for (const cycle of graph.cyclesBroken)
    warnings.push({
      code: 'CYCLE_BROKEN',
      message: `The prerequisites of ${cycle.members.map(nameOf).join(', ')} formed a loop. PrepFlow ignored “${nameOf(cycle.removed.to)} needs ${nameOf(cycle.removed.from)}” and kept the rest.`,
      topicIds: cycle.members,
    });
  if (graph.unknownReferences.length > 0)
    warnings.push({
      code: 'UNKNOWN_PREREQUISITE',
      message: `${graph.unknownReferences.length} prerequisite ${graph.unknownReferences.length === 1 ? 'link pointed' : 'links pointed'} at topics that do not exist and ${graph.unknownReferences.length === 1 ? 'was' : 'were'} ignored.`,
      topicIds: [...new Set(graph.unknownReferences.map((r) => r.topicId))],
    });
  if (status === 'OVER_CAPACITY' || status === 'NO_CAPACITY') {
    if (topics.length > 0 && daysToExam > 0)
      warnings.push({
        code: 'OVER_CAPACITY',
        message: `You have ${formatMinutes(gap)} less study capacity than the remaining material needs. Deferred: ${deferredTopics
          .slice(0, 5)
          .map((t) => t.name)
          .join(
            ', ',
          )}${deferredTopics.length > 5 ? ` and ${deferredTopics.length - 5} more` : ''}.`,
        topicIds: deferredTopics.map((t) => t.id),
      });
  }
  if (scheduled.droppedRevisions.length > 0)
    warnings.push({
      code: 'REVISION_SQUEEZED',
      message: `${scheduled.droppedRevisions.length} revision ${scheduled.droppedRevisions.length === 1 ? 'session' : 'sessions'} did not fit before the exam.`,
    });
  if (scheduled.compressedRevisions > 0)
    warnings.push({
      code: 'REVISION_COMPRESSED',
      message: 'The exam is close, so some topics get one final review instead of spaced revision.',
    });

  if (all.length > PLAN_TUNING.maxTasks)
    throw new PlanningInputError(
      'PLAN_TOO_LARGE',
      'This plan would have too many tasks. Remove some material and try again.',
    );

  return {
    tasks: all,
    summary: {
      fit,
      tiers: tierSummary,
      topics: insights,
      warnings,
      graph: {
        topics: topics.length,
        edges: graph.edgeCount,
        orphans: graph.orphans.length,
        cyclesBroken: graph.cyclesBroken.length,
      },
      revision: {
        scheduled: newTasks.filter((t) => t.type === 'REVISION').length,
        dropped: scheduled.droppedRevisions.length,
        compressed: scheduled.compressedRevisions,
      },
      recovery: null,
    },
  };
}

export { G as PLAN_GRANULARITY };
