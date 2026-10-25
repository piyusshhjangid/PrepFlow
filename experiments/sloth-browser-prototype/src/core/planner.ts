import { addDays, daysBetween, isISODate, type ISODate } from './dates';
import { effectiveScores, isActive } from './priority';
import { roundToFive } from './topics';
import type { ProgressMap, Topic, TopicProgress } from './types';

export interface PlanSettings {
  today: ISODate;
  examDate: ISODate;
  minutesPerDay: number;
  /** Longest single sitting on one topic. */
  sessionMinutes: number;
  /** Days after the last study session when a review is due. */
  revisionIntervals: number[];
}

export const DEFAULTS = {
  minutesPerDay: 120,
  sessionMinutes: 45,
  revisionIntervals: [1, 3],
} as const;
export const LIMITS = {
  minMinutesPerDay: 15,
  maxMinutesPerDay: 720,
  minSession: 15,
  maxSession: 120,
} as const;
/** Smallest piece of a topic worth scheduling (unless the whole remainder is smaller). */
const MIN_CHUNK = 15;
/** Reviews may use at most this share of a normal day, so they cannot starve new learning. */
const REVISION_SHARE = 0.4;
const MIN_REVISION = 10;
const REVISION_FRACTION = 0.25;

export interface PlanTask {
  id: string;
  kind: 'study' | 'revision';
  topicId: string;
  date: ISODate;
  minutes: number;
  /** For study tasks: which sitting of the topic this is. */
  part?: { index: number; total: number };
  /** For revision tasks: 0-based review number. */
  reviewIndex?: number;
}

export interface PlanDay {
  date: ISODate;
  capacity: number;
  usedMinutes: number;
  tasks: PlanTask[];
}

export interface Unscheduled {
  topicId: string;
  minutes: number;
}

export interface DroppedRevision {
  topicId: string;
  reviewIndex: number;
  reason: 'no-room' | 'exam-too-close';
}

export type Fit = 'done' | 'fits' | 'tight' | 'overflow' | 'no-days';

export interface Plan {
  days: PlanDay[];
  unscheduled: Unscheduled[];
  droppedRevisions: DroppedRevision[];
  fit: Fit;
  stats: {
    studyDays: number;
    capacityMinutes: number;
    requiredMinutes: number;
    scheduledStudyMinutes: number;
    unscheduledMinutes: number;
    revisionMinutes: number;
  };
}

export function validateSettings(s: PlanSettings): string[] {
  const errors: string[] = [];
  if (!isISODate(s.today)) errors.push('Today’s date is not valid.');
  if (!isISODate(s.examDate)) errors.push('Choose a valid exam date.');
  if (
    !Number.isInteger(s.minutesPerDay) ||
    s.minutesPerDay < LIMITS.minMinutesPerDay ||
    s.minutesPerDay > LIMITS.maxMinutesPerDay
  )
    errors.push(
      `Daily study time must be between ${LIMITS.minMinutesPerDay} and ${LIMITS.maxMinutesPerDay} minutes.`,
    );
  if (
    !Number.isInteger(s.sessionMinutes) ||
    s.sessionMinutes < LIMITS.minSession ||
    s.sessionMinutes > LIMITS.maxSession
  )
    errors.push(
      `Session length must be between ${LIMITS.minSession} and ${LIMITS.maxSession} minutes.`,
    );
  if (s.revisionIntervals.some((n) => !Number.isInteger(n) || n < 1 || n > 60))
    errors.push('Revision intervals must be whole days between 1 and 60.');
  if (isISODate(s.today) && isISODate(s.examDate) && daysBetween(s.today, s.examDate) > 400)
    errors.push('The exam is more than 400 days away; plan closer to the date.');
  return errors;
}

export const emptyProgress = (): TopicProgress => ({
  studiedMinutes: 0,
  lastStudiedOn: null,
  reviewsDone: 0,
});

interface Pending {
  topicId: string;
  reviewIndex: number;
  due: ISODate;
}

export function reviewMinutes(topic: Topic): number {
  return Math.max(MIN_REVISION, roundToFive(topic.minutes * REVISION_FRACTION));
}

/**
 * Pure and deterministic: the same topics, settings and progress always give the same plan.
 * The plan is rebuilt from today every time, so missed work simply slides forward instead of piling up as "overdue".
 */
export function buildPlan(topics: Topic[], settings: PlanSettings, progress: ProgressMap): Plan {
  const errors = validateSettings(settings);
  if (errors.length > 0) throw new RangeError(errors.join(' '));
  // Prefer one sitting per topic per day (spreads learning out). Only if that leaves study time unscheduled
  // is a second sitting of the same topic allowed on one day, so the plan never reports a false overflow.
  const spread = schedule(topics, settings, progress, false);
  if (spread.unscheduled.length === 0) return spread;
  return schedule(topics, settings, progress, true);
}

function schedule(
  topics: Topic[],
  settings: PlanSettings,
  progress: ProgressMap,
  allowRepeat: boolean,
): Plan {
  const { today, examDate, minutesPerDay, sessionMinutes, revisionIntervals } = settings;
  const lastStudyDay = addDays(examDate, -1);
  const dayCount = Math.max(0, daysBetween(today, examDate));
  const dates: ISODate[] = Array.from({ length: dayCount }, (_, i) => addDays(today, i));

  const active = topics.filter(isActive);
  const scores = effectiveScores(topics);
  const byId = new Map(topics.map((t) => [t.id, t]));
  const prog = (id: string) => progress[id] ?? emptyProgress();
  const remaining = new Map<string, number>();
  for (const t of active) remaining.set(t.id, Math.max(0, t.minutes - prog(t.id).studiedMinutes));

  const order = (a: Topic, b: Topic) =>
    (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) ||
    a.order - b.order ||
    a.id.localeCompare(b.id);
  const ranked = [...active].sort(order);

  const requiredMinutes = [...remaining.values()].reduce((a, b) => a + b, 0);
  const droppedRevisions: DroppedRevision[] = [];
  const pending: Pending[] = [];

  /** Queue the reviews of a topic whose studying finished on `base`. */
  const queueReviews = (topic: Topic, base: ISODate, from: number) => {
    const seenDays = new Set<ISODate>();
    for (let k = from; k < revisionIntervals.length; k++) {
      let due = addDays(base, revisionIntervals[k]!);
      if (daysBetween(due, examDate) <= 0) {
        // Too close to the exam: pull it back to the last study day if that is after the study ended.
        if (daysBetween(base, lastStudyDay) >= 1) due = lastStudyDay;
        else {
          droppedRevisions.push({ topicId: topic.id, reviewIndex: k, reason: 'exam-too-close' });
          continue;
        }
      }
      if (daysBetween(due, today) > 0) due = today; // overdue reviews roll forward
      if (seenDays.has(due)) continue; // two intervals landing on one day collapse into a single review
      seenDays.add(due);
      pending.push({ topicId: topic.id, reviewIndex: k, due });
    }
  };

  // Topics already fully studied only need their remaining reviews.
  for (const t of ranked) {
    const p = prog(t.id);
    if ((remaining.get(t.id) ?? 0) === 0 && p.studiedMinutes > 0 && p.lastStudiedOn) {
      queueReviews(t, p.lastStudiedOn, p.reviewsDone);
    }
  }

  const finished = (id: string): boolean => {
    const t = byId.get(id);
    if (!t || !isActive(t)) return true; // excluded, known or unknown prerequisites do not block
    return (remaining.get(id) ?? 0) === 0;
  };

  const days: PlanDay[] = [];
  for (const date of dates) {
    const isLast = date === lastStudyDay;
    const day: PlanDay = { date, capacity: minutesPerDay, usedMinutes: 0, tasks: [] };
    const revisionBudget = isLast
      ? minutesPerDay
      : Math.floor((minutesPerDay * REVISION_SHARE) / 5) * 5;
    let revisionUsed = 0;

    const due = pending
      .filter((p) => p.due <= date)
      .sort(
        (a, b) => a.due.localeCompare(b.due) || order(byId.get(a.topicId)!, byId.get(b.topicId)!),
      );
    for (const p of due) {
      const topic = byId.get(p.topicId)!;
      const minutes = Math.min(reviewMinutes(topic), minutesPerDay);
      if (revisionUsed + minutes > revisionBudget || day.usedMinutes + minutes > minutesPerDay)
        continue;
      day.tasks.push({
        id: `rev:${topic.id}:${p.reviewIndex}`,
        kind: 'revision',
        topicId: topic.id,
        date,
        minutes,
        reviewIndex: p.reviewIndex,
      });
      day.usedMinutes += minutes;
      revisionUsed += minutes;
      pending.splice(pending.indexOf(p), 1);
    }

    const sittings = new Map<string, number>();
    for (;;) {
      const room = minutesPerDay - day.usedMinutes;
      if (room < Math.min(MIN_CHUNK, 5)) break;
      const candidate = ranked.find((t) => {
        const left = remaining.get(t.id) ?? 0;
        if (left <= 0 || (!allowRepeat && sittings.has(t.id))) return false;
        if (!t.prerequisites.every(finished)) return false;
        return left < MIN_CHUNK ? room >= left : room >= MIN_CHUNK;
      });
      if (!candidate) break;
      const left = remaining.get(candidate.id)!;
      const minutes = Math.min(left, sessionMinutes, room);
      const take = minutes;
      remaining.set(candidate.id, left - take);
      const n = (sittings.get(candidate.id) ?? 0) + 1;
      sittings.set(candidate.id, n);
      day.tasks.push({
        id: `study:${candidate.id}:${date}:${n}`,
        kind: 'study',
        topicId: candidate.id,
        date,
        minutes: take,
      });
      day.usedMinutes += take;
      if (left - take === 0) queueReviews(candidate, date, prog(candidate.id).reviewsDone);
    }
    days.push(day);
  }

  for (const p of pending) {
    droppedRevisions.push({ topicId: p.topicId, reviewIndex: p.reviewIndex, reason: 'no-room' });
  }

  // Label sittings "part i of n".
  const totals = new Map<string, number>();
  for (const d of days)
    for (const t of d.tasks)
      if (t.kind === 'study') totals.set(t.topicId, (totals.get(t.topicId) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const d of days) {
    for (const t of d.tasks) {
      if (t.kind !== 'study') continue;
      const index = (seen.get(t.topicId) ?? 0) + 1;
      seen.set(t.topicId, index);
      t.part = { index, total: totals.get(t.topicId)! };
    }
  }

  const unscheduled: Unscheduled[] = ranked
    .filter((t) => (remaining.get(t.id) ?? 0) > 0)
    .map((t) => ({ topicId: t.id, minutes: remaining.get(t.id)! }));
  const unscheduledMinutes = unscheduled.reduce((a, b) => a + b.minutes, 0);
  const scheduledStudy = days.reduce(
    (a, d) => a + d.tasks.filter((t) => t.kind === 'study').reduce((x, t) => x + t.minutes, 0),
    0,
  );
  const revisionMinutes = days.reduce(
    (a, d) => a + d.tasks.filter((t) => t.kind === 'revision').reduce((x, t) => x + t.minutes, 0),
    0,
  );
  const capacityMinutes = dayCount * minutesPerDay;
  const hasTasks = days.some((d) => d.tasks.length > 0);

  let fit: Fit;
  if (requiredMinutes === 0 && !hasTasks && droppedRevisions.length === 0) fit = 'done';
  else if (dayCount === 0 && (requiredMinutes > 0 || pending.length > 0)) fit = 'no-days';
  else if (unscheduledMinutes > 0) fit = 'overflow';
  else if (capacityMinutes > 0 && (scheduledStudy + revisionMinutes) / capacityMinutes > 0.9)
    fit = 'tight';
  else fit = 'fits';

  return {
    days,
    unscheduled,
    droppedRevisions,
    fit,
    stats: {
      studyDays: dayCount,
      capacityMinutes,
      requiredMinutes,
      scheduledStudyMinutes: scheduledStudy,
      unscheduledMinutes,
      revisionMinutes,
    },
  };
}

/** The first task in time order: today's first if there is one. */
export function nextTask(plan: Plan): PlanTask | null {
  for (const d of plan.days) if (d.tasks.length > 0) return d.tasks[0]!;
  return null;
}

export interface Adjustment {
  /** Smallest daily time (in 5-minute steps, up to 8 hours) at which everything would be scheduled; null if none. */
  minutesPerDayToFitAll: number | null;
}

/** Deterministic "what would it take" search for an overflowing plan. */
export function suggestAdjustment(
  topics: Topic[],
  settings: PlanSettings,
  progress: ProgressMap,
): Adjustment {
  for (let m = settings.minutesPerDay + 5; m <= 480; m += 5) {
    const plan = buildPlan(topics, { ...settings, minutesPerDay: m }, progress);
    if (plan.unscheduled.length === 0) return { minutesPerDayToFitAll: m };
  }
  return { minutesPerDayToFitAll: null };
}

/** Applies a completed task to the progress map. Pure; returns a new map. */
export function completeTask(task: PlanTask, progress: ProgressMap, today: ISODate): ProgressMap {
  const current = progress[task.topicId] ?? emptyProgress();
  const next: TopicProgress =
    task.kind === 'study'
      ? { ...current, studiedMinutes: current.studiedMinutes + task.minutes, lastStudiedOn: today }
      : { ...current, reviewsDone: Math.max(current.reviewsDone, (task.reviewIndex ?? 0) + 1) };
  return { ...progress, [task.topicId]: next };
}
