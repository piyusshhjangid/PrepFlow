import type { PriorityTier } from '@prepflow/shared';
import { MIN_REVISION_MINUTES, PLAN_TUNING } from './config.js';
import { planRevisionDates, revisionMinutes } from './revision.js';
import type { DayCapacity } from './types.js';

/**
 * The calendar packer. Pure and deterministic: it walks the study days in order and, each day,
 *
 *   1. places due REVISION sessions, up to the day's revision reserve (earliest due first);
 *   2. fills the rest with STUDY, always taking the best READY topic that still fits, where
 *      ready = every prerequisite is already finished, and best = tier, then inherited priority;
 *   3. uses whatever is left for revision that did not fit the reserve.
 *
 * A day is never filled beyond `usable` (the student's time minus the buffer). A topic gets at most
 * one sitting per day, at most `maxSessionMinutes` long; bigger topics continue on later days.
 */

export interface SchedTopic {
  id: string;
  name: string;
  tier: Exclude<PriorityTier, 'DEFER'>;
  score: number;
  /** The topic's score, raised to just below its most important dependent so prerequisites come early. */
  effScore: number;
  depth: number;
  order: number;
  /** Study minutes still to place (0 for topics that are already finished). */
  remaining: number;
  estimated: number;
  revisionWeight: number;
  /** Prerequisites that are part of this plan (finished ones are fine). */
  prereqs: string[];
  /** For finished topics: when they were studied, so revision can follow. */
  studiedOn: string | null;
  revisionDone: number;
}

export interface SchedTask {
  topicId: string;
  type: 'STUDY' | 'REVISION';
  date: string;
  minutes: number;
  revisionIndex: number | null;
  compressed: boolean;
  /** Creation sequence; orders tasks within a day. */
  seq: number;
}

export interface ScheduleResult {
  tasks: SchedTask[];
  unscheduledStudy: Map<string, number>;
  droppedRevisions: { topicId: string; index: number; minutes: number }[];
  compressedRevisions: number;
}

interface RevisionItem {
  topicId: string;
  index: number;
  due: string;
  minutes: number;
  compressed: boolean;
  placed: boolean;
}

const TIER_RANK: Record<string, number> = { MUST: 0, SHOULD: 1, IF_TIME: 2 };
const G = PLAN_TUNING.granularity;

export function compareTopics(a: SchedTopic, b: SchedTopic): number {
  return (
    (TIER_RANK[a.tier] as number) - (TIER_RANK[b.tier] as number) ||
    b.effScore - a.effScore ||
    a.depth - b.depth ||
    a.order - b.order ||
    a.id.localeCompare(b.id)
  );
}

export function runSchedule(input: {
  calendar: readonly DayCapacity[];
  topics: readonly SchedTopic[];
  today: string;
  intervals: readonly number[];
  /** Minutes already used on a date by tasks that are kept as they are. */
  prefilled: ReadonlyMap<string, number>;
}): ScheduleResult {
  const { calendar, today, intervals, prefilled } = input;
  const studyDays = calendar.map((d) => d.date);
  const topics = input.topics.map((t) => ({ ...t, lastPlacedDate: null as string | null }));
  const byId = new Map(topics.map((t) => [t.id, t]));
  const finished = new Set(topics.filter((t) => t.remaining <= 0).map((t) => t.id));
  const queue = topics.filter((t) => t.remaining > 0).sort(compareTopics);

  const tasks: SchedTask[] = [];
  const pool: RevisionItem[] = [];
  let seq = 0;
  let compressedRevisions = 0;

  const scheduleRevisions = (topicId: string, studiedOn: string, doneCount: number): void => {
    const topic = byId.get(topicId) as SchedTopic;
    const slots = planRevisionDates({
      studiedOn,
      today,
      studyDays,
      intervals,
      doneCount,
      tier: topic.tier,
      score: topic.score,
    });
    for (const slot of slots) {
      pool.push({
        topicId,
        index: slot.index,
        due: slot.due,
        minutes: revisionMinutes(topic.estimated, topic.revisionWeight, slot.index),
        compressed: slot.compressed,
        placed: false,
      });
      if (slot.compressed) compressedRevisions += 1;
    }
  };

  for (const t of topics) {
    if (t.remaining <= 0 && t.studiedOn) scheduleRevisions(t.id, t.studiedOn, t.revisionDone);
  }

  const revisionOrder = (a: RevisionItem, b: RevisionItem) => {
    const ta = byId.get(a.topicId) as SchedTopic;
    const tb = byId.get(b.topicId) as SchedTopic;
    return (
      a.due.localeCompare(b.due) ||
      (TIER_RANK[ta.tier] as number) - (TIER_RANK[tb.tier] as number) ||
      tb.effScore - ta.effScore ||
      a.index - b.index ||
      ta.order - tb.order ||
      a.topicId.localeCompare(b.topicId)
    );
  };

  for (const day of calendar) {
    let load = prefilled.get(day.date) ?? 0;
    const place = (task: Omit<SchedTask, 'seq' | 'date'>): void => {
      tasks.push({ ...task, date: day.date, seq: (seq += 1) });
      load += task.minutes;
    };

    // Revision sessions are never longer than the reserve, so the reserve always buys at least one.
    const cap = day.revisionReserve >= MIN_REVISION_MINUTES ? day.revisionReserve : Infinity;
    const placeRevision = (item: RevisionItem): void => {
      item.minutes = Math.min(item.minutes, Math.max(MIN_REVISION_MINUTES, cap));
      item.placed = true;
      place({
        topicId: item.topicId,
        type: 'REVISION',
        minutes: item.minutes,
        revisionIndex: item.index,
        compressed: item.compressed,
      });
    };

    // 1. due revision, within the reserve
    let revisionUsed = 0;
    for (const item of pool.filter((i) => !i.placed && i.due <= day.date).sort(revisionOrder)) {
      const minutes = Math.min(item.minutes, Math.max(MIN_REVISION_MINUTES, cap));
      if (revisionUsed + minutes <= day.revisionReserve && load + minutes <= day.usable) {
        placeRevision(item);
        revisionUsed += minutes;
      }
    }

    // 2. study, best ready topic first
    for (let progressed = true; progressed;) {
      progressed = false;
      for (const topic of queue) {
        if (topic.remaining <= 0 || topic.lastPlacedDate === day.date) continue;
        if (!topic.prereqs.every((p) => finished.has(p))) continue;
        const room = day.usable - load;
        const minChunk = Math.min(PLAN_TUNING.minChunkMinutes, day.usable);
        const wanted = Math.min(topic.remaining, PLAN_TUNING.maxSessionMinutes, room);
        let chunk = wanted < topic.remaining ? Math.floor(wanted / G) * G : wanted;
        const tail = topic.remaining - chunk;
        if (tail > 0 && tail < minChunk) {
          // Avoid leaving a sliver for tomorrow when a slightly shorter sitting avoids it.
          const adjusted = Math.floor((topic.remaining - minChunk) / G) * G;
          if (adjusted >= minChunk) chunk = adjusted;
        }
        if (chunk <= 0 || chunk < Math.min(minChunk, topic.remaining)) continue;
        place({
          topicId: topic.id,
          type: 'STUDY',
          minutes: chunk,
          revisionIndex: null,
          compressed: false,
        });
        topic.remaining -= chunk;
        topic.lastPlacedDate = day.date;
        if (topic.remaining <= 0) {
          finished.add(topic.id);
          scheduleRevisions(topic.id, day.date, topic.revisionDone);
        }
        progressed = true;
        break;
      }
    }

    // 3. leftover time takes revision that did not fit the reserve
    for (const item of pool.filter((i) => !i.placed && i.due <= day.date).sort(revisionOrder)) {
      if (load + item.minutes <= day.usable) placeRevision(item);
    }
  }

  return {
    tasks,
    unscheduledStudy: new Map(
      topics.filter((t) => t.remaining > 0).map((t) => [t.id, t.remaining]),
    ),
    droppedRevisions: pool
      .filter((i) => !i.placed)
      .map((i) => ({ topicId: i.topicId, index: i.index, minutes: i.minutes })),
    compressedRevisions,
  };
}
