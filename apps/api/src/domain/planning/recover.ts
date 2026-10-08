import type { PlanWarning, RecoveryReport } from '@prepflow/shared';
import { assertValidConfig, buildCalendar } from './capacity.js';
import { PLAN_TUNING } from './config.js';
import { buildDependencyGraph } from './graph.js';
import { numberParts, orderTasks } from './planner.js';
import {
  formatMinutes,
  type HistoryTask,
  type PlanConfig,
  type PlanTopic,
  type TaskDraft,
} from './types.js';

const G = PLAN_TUNING.granularity;
const TIER_RANK = { MUST: 0, SHOULD: 1, IF_TIME: 2, DEFER: 3 } as const;

export interface RecoverInput {
  tasks: readonly HistoryTask[];
  topics: readonly PlanTopic[];
  config: PlanConfig;
}

export interface RecoverOutput {
  tasks: TaskDraft[];
  report: RecoveryReport;
  warnings: PlanWarning[];
}

const copy = (t: HistoryTask): TaskDraft => {
  const { id, ...rest } = t;
  return { ...rest, carriedFromTaskId: id };
};

/**
 * Missed-task recovery. Open tasks dated before today are moved into spare time on the days that
 * remain, splitting them across days when needed. Everything else stays exactly where it is.
 *
 *   1. spare planned time (usable minus what is already scheduled) is used first;
 *   2. the daily buffer exists for exactly this, so it is used second;
 *   3. anything that still does not fit is NOT forced into a day. It stays overdue and is reported
 *      as `overloadMinutes`, so the student sees the real tradeoff (a full re-plan can then defer
 *      lower-priority work).
 */
export function recoverMissedTasks(input: RecoverInput): RecoverOutput {
  const { config } = input;
  assertValidConfig(config);
  const calendar = buildCalendar(config);
  const today = config.today;

  const missed = input.tasks.filter((t) => t.status === 'PENDING' && t.date < today);
  const rest = input.tasks.filter((t) => !(t.status === 'PENDING' && t.date < today));

  const load = new Map<string, number>();
  for (const t of rest)
    if (t.status !== 'SKIPPED') load.set(t.date, (load.get(t.date) ?? 0) + t.minutes);

  missed.sort(
    (a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      b.priorityScore - a.priorityScore ||
      a.date.localeCompare(b.date) ||
      a.sortOrder - b.sortOrder ||
      a.id.localeCompare(b.id),
  );

  const recovered: TaskDraft[] = [];
  const stillOverdue: TaskDraft[] = [];
  const moves: RecoveryReport['moves'] = [];
  let recoveredMinutes = 0;
  let usedBuffer = 0;

  for (const task of missed) {
    let left = task.minutes;
    const pieces: { date: string; minutes: number }[] = [];
    const minPiece = (room: number) => Math.min(PLAN_TUNING.minChunkMinutes, room, left);

    for (const useBuffer of [false, true]) {
      for (const day of calendar) {
        if (left <= 0) break;
        const current = load.get(day.date) ?? 0;
        const ceiling = useBuffer ? day.total : day.usable;
        const room = Math.floor(Math.max(0, ceiling - current) / G) * G;
        const take = Math.min(left, room);
        if (take <= 0 || take < minPiece(room)) continue;
        pieces.push({ date: day.date, minutes: take });
        load.set(day.date, current + take);
        if (useBuffer) usedBuffer += Math.max(0, current + take - Math.max(day.usable, current));
        left -= take;
      }
    }

    pieces.forEach((p, i) => {
      recovered.push({
        ...copy(task),
        date: p.date,
        originalDate: task.originalDate ?? task.date,
        minutes: p.minutes,
        sortOrder: -1_000_000 + recovered.length,
        reasons: [`Missed on ${task.date}; moved here`, ...task.reasons.slice(0, 2)],
        carriedFromTaskId: task.id,
      });
      moves.push({
        topicName: task.topicName,
        type: task.type,
        from: task.date,
        to: p.date,
        minutes: p.minutes,
      });
      recoveredMinutes += p.minutes;
      void i;
    });
    if (left > 0) {
      stillOverdue.push({
        ...copy(task),
        minutes: left,
        reasons: [
          `Missed on ${task.date}; there is no room left to move it`,
          ...task.reasons.slice(0, 2),
        ],
      });
    }
  }

  const missedMinutes = missed.reduce((a, t) => a + t.minutes, 0);
  const overloadMinutes = stillOverdue.reduce((a, t) => a + t.minutes, 0);

  // Did recovery put a prerequisite after something that builds on it?
  const warnings: PlanWarning[] = [];
  const graph = buildDependencyGraph(input.topics);
  const firstStudyDate = new Map<string, string>();
  for (const t of [...rest, ...recovered.map((r) => ({ ...r, status: r.status }))] as TaskDraft[]) {
    if (t.type !== 'STUDY' || t.topicId === null || t.status === 'SKIPPED') continue;
    const prev = firstStudyDate.get(t.topicId);
    if (prev === undefined || t.date < prev) firstStudyDate.set(t.topicId, t.date);
  }
  const flagged = new Set<string>();
  for (const piece of recovered) {
    if (piece.type !== 'STUDY' || piece.topicId === null) continue;
    for (const dependent of graph.dependents.get(piece.topicId) ?? []) {
      const start = firstStudyDate.get(dependent);
      if (start !== undefined && start < piece.date)
        flagged.add(`${piece.topicName}\u0000${dependent}`);
    }
  }
  if (flagged.size > 0)
    warnings.push({
      code: 'RECOVERY_ORDER',
      message:
        'Some recovered tasks now come after topics that build on them. Re-plan the remaining work to restore the right order.',
    });
  if (overloadMinutes > 0)
    warnings.push({
      code: 'PLAN_OVERLOADED',
      message: `The plan is now overloaded by ${formatMinutes(overloadMinutes)}: that much missed work does not fit in the days left. Re-plan the remaining work to see what PrepFlow would defer.`,
    });

  const keptDrafts = rest.map(copy);
  const recoveredSet = new Set(recovered);
  const tasks = orderTasks([...keptDrafts, ...recovered, ...stillOverdue], (t) =>
    recoveredSet.has(t) ? 0 : 1,
  );
  numberParts(tasks);

  return {
    tasks,
    warnings,
    report: {
      missedTasks: missed.length,
      missedMinutes,
      recoveredMinutes,
      usedBufferMinutes: usedBuffer,
      overloadMinutes,
      moves,
    },
  };
}
