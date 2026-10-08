import { addDaysIso } from '@prepflow/shared';
import { describe, expect, it } from 'vitest';
import { buildCalendar } from './capacity.js';
import { config } from './fixtures.js';
import { generatePlan } from './planner.js';
import { recoverMissedTasks } from './recover.js';
import type { HistoryTask, PlanConfig, PlanTopic, TaskDraft } from './types.js';

/** Small deterministic PRNG (mulberry32): the property tests are reproducible, not flaky. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scenario(seed: number): { topics: PlanTopic[]; cfg: PlanConfig } {
  const r = rng(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)] as T;
  const n = 1 + Math.floor(r() * 40);
  const topics: PlanTopic[] = Array.from({ length: n }, (_, i) => ({
    id: `t${String(i).padStart(3, '0')}`,
    name: `Topic ${i}`,
    subjectId: 's',
    subjectName: `Subject ${i % 3}`,
    order: i,
    difficulty: pick(['EASY', 'MEDIUM', 'HARD'] as const),
    importance: pick(['LOW', 'MEDIUM', 'HIGH'] as const),
    estimatedMinutes: 10 + Math.floor(r() * 46) * 5,
    revisionWeight: Math.round(r() * 100) / 100,
    statedEmphasis: r() < 0.2,
    confidence: Math.round(r() * 100) / 100,
    isWeak: r() < 0.25,
    prerequisiteIds: [],
    evidenceCount: 1 + Math.floor(r() * 3),
    evidence: null,
  }));
  // random prerequisite claims, including backward ones (so cycles occur) and junk ids
  for (const t of topics) {
    const k = Math.floor(r() * 3);
    for (let j = 0; j < k; j += 1)
      t.prerequisiteIds.push(r() < 0.05 ? 'ghost' : (pick(topics) as PlanTopic).id);
  }
  const days = Math.floor(r() * 60);
  const weekdays = [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.8);
  const today = '2026-10-05';
  const blocked = Array.from({ length: Math.floor(r() * 4) }, () =>
    addDaysIso(today, Math.floor(r() * 30)),
  );
  return {
    topics,
    cfg: config({
      today,
      examDate: addDaysIso(today, days),
      minutesPerDay: 15 + Math.floor(r() * 40) * 15,
      studyWeekdays: weekdays,
      blockedDates: blocked,
      bufferPct: Math.floor(r() * 31),
      revisionReservePct: Math.floor(r() * 31),
      revisionIntervalsDays: [1, 3, 7].slice(0, Math.floor(r() * 4)),
      learnerConfidence: r() < 0.5 ? null : 1 + Math.floor(r() * 5),
    }),
  };
}

const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);
const histFrom = (tasks: TaskDraft[]): HistoryTask[] =>
  tasks.map((t, i) => ({ ...t, id: `x${i}` }));

describe('scenario generator coverage', () => {
  it('actually exercises plans, revision, deferral, cycles and empty windows', () => {
    let withTasks = 0,
      withRevision = 0,
      over = 0,
      cycles = 0,
      empty = 0;
    for (const seed of SEEDS) {
      const { topics, cfg } = scenario(seed);
      const out = generatePlan({ topics, config: cfg });
      if (out.tasks.length > 0) withTasks += 1;
      else empty += 1;
      if (out.tasks.some((t) => t.type === 'REVISION')) withRevision += 1;
      if (out.summary.fit.status === 'OVER_CAPACITY') over += 1;
      if (out.summary.graph.cyclesBroken > 0) cycles += 1;
    }
    expect(withTasks).toBeGreaterThan(100);
    expect(withRevision).toBeGreaterThan(40);
    expect(over).toBeGreaterThan(20);
    expect(cycles).toBeGreaterThan(20);
    expect(empty).toBeGreaterThan(0);
  });
});

describe('planner invariants (150 seeded random scenarios)', () => {
  it('daily load never exceeds the day’s usable minutes, and only study days are used', () => {
    for (const seed of SEEDS) {
      const { topics, cfg } = scenario(seed);
      const out = generatePlan({ topics, config: cfg });
      const calendar = new Map(buildCalendar(cfg).map((d) => [d.date, d]));
      const load = new Map<string, number>();
      for (const t of out.tasks) {
        expect(calendar.has(t.date), `seed ${seed}: task on non-study day ${t.date}`).toBe(true);
        load.set(t.date, (load.get(t.date) ?? 0) + t.minutes);
      }
      for (const [date, minutes] of load)
        expect(minutes, `seed ${seed} ${date}`).toBeLessThanOrEqual(
          (calendar.get(date) as { usable: number }).usable,
        );
    }
  });

  it('no task is dated on or after the exam, or before today', () => {
    for (const seed of SEEDS) {
      const { topics, cfg } = scenario(seed);
      for (const t of generatePlan({ topics, config: cfg }).tasks) {
        expect(t.date < cfg.examDate, `seed ${seed}`).toBe(true);
        expect(t.date >= cfg.today, `seed ${seed}`).toBe(true);
      }
    }
  });

  it('revision never precedes the end of studying and never lands after the last study day', () => {
    for (const seed of SEEDS) {
      const { topics, cfg } = scenario(seed);
      const out = generatePlan({ topics, config: cfg });
      const lastStudy = new Map<string, string>();
      for (const t of out.tasks)
        if (t.type === 'STUDY' && t.topicId)
          lastStudy.set(
            t.topicId,
            t.date > (lastStudy.get(t.topicId) ?? '')
              ? t.date
              : (lastStudy.get(t.topicId) as string),
          );
      for (const t of out.tasks.filter((x) => x.type === 'REVISION')) {
        expect(t.date > (lastStudy.get(t.topicId as string) as string), `seed ${seed}`).toBe(true);
        expect(t.date < cfg.examDate).toBe(true);
      }
    }
  });

  it('every task references an existing topic and has a positive, 5-minute-multiple length', () => {
    for (const seed of SEEDS) {
      const { topics, cfg } = scenario(seed);
      const ids = new Set(topics.map((t) => t.id));
      for (const t of generatePlan({ topics, config: cfg }).tasks) {
        expect(ids.has(t.topicId as string), `seed ${seed}`).toBe(true);
        expect(t.minutes).toBeGreaterThan(0);
        if (t.type === 'STUDY') expect(t.minutes % 5).toBe(0);
      }
    }
  });

  it('study minutes are conserved: scheduled + deferred = required, and per topic never above the estimate', () => {
    for (const seed of SEEDS) {
      const { topics, cfg } = scenario(seed);
      const out = generatePlan({ topics, config: cfg });
      const { fit } = out.summary;
      expect(fit.scheduledStudyMinutes + fit.deferredStudyMinutes, `seed ${seed}`).toBe(
        fit.requiredStudyMinutes,
      );
      for (const topic of topics) {
        const placed = out.tasks
          .filter((t) => t.topicId === topic.id && t.type === 'STUDY')
          .reduce((a, t) => a + t.minutes, 0);
        expect(placed).toBeLessThanOrEqual(topic.estimatedMinutes);
      }
    }
  });

  it('a prerequisite finishes before its dependent starts, whenever both are scheduled in full', () => {
    for (const seed of SEEDS) {
      const { topics, cfg } = scenario(seed);
      const out = generatePlan({ topics, config: cfg });
      const insight = new Map(out.summary.topics.map((t) => [t.topicId, t]));
      for (const t of out.summary.topics) {
        for (const pre of t.prerequisites) {
          const a = insight.get(pre.id)!;
          if (a.scheduledMinutes < a.requiredMinutes || t.scheduledMinutes === 0) continue;
          const preLast = out.tasks
            .filter((x) => x.topicId === pre.id && x.type === 'STUDY')
            .map((x) => x.date)
            .sort()
            .at(-1);
          const depFirst = out.tasks
            .filter((x) => x.topicId === t.topicId && x.type === 'STUDY')
            .map((x) => x.date)
            .sort()[0];
          if (preLast && depFirst)
            expect(preLast <= depFirst, `seed ${seed}: ${pre.id} -> ${t.topicId}`).toBe(true);
        }
      }
    }
  });

  it('the same input always produces the same plan (and input order does not matter)', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const { topics, cfg } = scenario(seed);
      const a = generatePlan({ topics, config: cfg });
      expect(
        generatePlan({ topics: structuredClone(topics), config: structuredClone(cfg) }),
      ).toEqual(a);
      expect(generatePlan({ topics: [...topics].reverse(), config: cfg })).toEqual(a);
    }
  });

  it('re-planning never deletes or changes completed tasks', () => {
    for (const seed of SEEDS) {
      const { topics, cfg } = scenario(seed);
      const first = generatePlan({ topics, config: cfg });
      const r = rng(seed + 9999);
      const history = histFrom(first.tasks).map((t) =>
        r() < 0.35
          ? {
              ...t,
              status: 'COMPLETED' as const,
              completedAt: '2026-10-06T08:00:00.000Z',
              actualMinutes: t.minutes,
            }
          : r() < 0.1
            ? { ...t, status: 'SKIPPED' as const }
            : t,
      );
      const later = { ...cfg, today: addDaysIso(cfg.today, 2) };
      const next = generatePlan({ topics, config: later, history });
      for (const done of history.filter(
        (t) => t.status === 'COMPLETED' || t.status === 'SKIPPED',
      )) {
        const kept = next.tasks.find((t) => t.carriedFromTaskId === done.id);
        expect(kept, `seed ${seed}: lost ${done.id}`).toBeDefined();
        expect(kept!.status).toBe(done.status);
        expect(kept!.date).toBe(done.date);
        expect(kept!.minutes).toBe(done.minutes);
        expect(kept!.completedAt).toBe(done.completedAt);
      }
      // nothing new is scheduled in the past
      for (const t of next.tasks.filter((x) => x.carriedFromTaskId === null))
        expect(t.date >= later.today).toBe(true);
    }
  });

  it('recovery never loses minutes: moved + still-overdue equals missed, and completed tasks are untouched', () => {
    for (const seed of SEEDS) {
      const { topics, cfg } = scenario(seed);
      const first = generatePlan({ topics, config: cfg });
      const history = histFrom(first.tasks).map((t, i) =>
        i % 5 === 0 ? { ...t, status: 'COMPLETED' as const } : t,
      );
      const later = { ...cfg, today: addDaysIso(cfg.today, 3) };
      const out = recoverMissedTasks({ tasks: history, topics, config: later });
      const minutesIn = history.reduce((a, t) => a + t.minutes, 0);
      const minutesOut = out.tasks.reduce((a, t) => a + t.minutes, 0);
      expect(minutesOut, `seed ${seed}`).toBe(minutesIn);
      expect(out.report.recoveredMinutes + out.report.overloadMinutes).toBe(
        out.report.missedMinutes,
      );
      for (const done of history.filter((t) => t.status === 'COMPLETED'))
        expect(
          out.tasks.some(
            (t) =>
              t.carriedFromTaskId === done.id && t.status === 'COMPLETED' && t.date === done.date,
          ),
        ).toBe(true);
    }
  });
});
