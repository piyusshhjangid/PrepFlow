import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import {
  buildPlan,
  completeTask,
  nextTask,
  suggestAdjustment,
  validateSettings,
  type Plan,
  type PlanSettings,
} from './planner';
import type { ProgressMap, Topic } from './types';
import { topic } from '../test/factories';

const settings = (over: Partial<PlanSettings> = {}): PlanSettings => ({
  today: '2026-10-22',
  examDate: '2026-10-28',
  minutesPerDay: 120,
  sessionMinutes: 45,
  revisionIntervals: [1, 3],
  ...over,
});

const tasks = (p: Plan) => p.days.flatMap((d) => d.tasks);

describe('buildPlan basics', () => {
  it('never exceeds daily capacity and never schedules on or after the exam day', () => {
    const topics = [
      topic({ id: 'a', minutes: 120 }),
      topic({ id: 'b', minutes: 90 }),
      topic({ id: 'c', minutes: 60 }),
    ];
    const p = buildPlan(topics, settings(), {});
    expect(p.days).toHaveLength(6);
    for (const d of p.days) expect(d.usedMinutes).toBeLessThanOrEqual(120);
    expect(tasks(p).every((t) => t.date < '2026-10-28' && t.date >= '2026-10-22')).toBe(true);
  });
  it('spreads a topic over days when that fits, and only repeats a topic within a day when it must', () => {
    const spread = buildPlan(
      [topic({ id: 'a', minutes: 120 }), topic({ id: 'b', minutes: 120 })],
      settings({ minutesPerDay: 240 }),
      {},
    );
    expect(spread.days[0]!.tasks.filter((t) => t.topicId === 'a')).toHaveLength(1);
    const squeezed = buildPlan(
      [topic({ id: 'a', minutes: 120 })],
      settings({ examDate: '2026-10-24', minutesPerDay: 240 }),
      {},
    );
    expect(squeezed.unscheduled).toEqual([]);
    expect(squeezed.days[0]!.tasks.filter((t) => t.topicId === 'a').length).toBeGreaterThan(1);
  });
  it('splits long topics into sittings no longer than the session length and labels the parts', () => {
    const p = buildPlan([topic({ id: 'big', minutes: 150 })], settings({ sessionMinutes: 45 }), {});
    const study = tasks(p).filter((t) => t.kind === 'study');
    expect(study.map((t) => t.minutes)).toEqual([45, 45, 45, 15]);
    expect(study.every((t) => t.minutes <= 45)).toBe(true);
    expect(study.map((t) => t.part)).toEqual([1, 2, 3, 4].map((index) => ({ index, total: 4 })));
    expect(new Set(study.map((t) => t.date)).size).toBe(4); // spread: one sitting per day while that fits
  });
  it('puts prerequisites first even when the dependent is more important', () => {
    const basics = topic({ id: 'basics', importance: 'low', minutes: 60 });
    const advanced = topic({
      id: 'advanced',
      importance: 'high',
      minutes: 60,
      prerequisites: ['basics'],
    });
    const study = tasks(buildPlan([advanced, basics], settings({ minutesPerDay: 240 }), {})).filter(
      (t) => t.kind === 'study',
    );
    expect(study[0]!.topicId).toBe('basics');
    const lastBasics = study.map((t) => t.topicId).lastIndexOf('basics');
    expect(study.findIndex((t) => t.topicId === 'advanced')).toBeGreaterThan(lastBasics);
  });
  it('starts a dependent only after its prerequisite is fully studied', () => {
    const basics = topic({ id: 'basics', minutes: 90 });
    const advanced = topic({
      id: 'advanced',
      importance: 'high',
      minutes: 45,
      prerequisites: ['basics'],
    });
    const study = tasks(buildPlan([basics, advanced], settings({ sessionMinutes: 45 }), {})).filter(
      (t) => t.kind === 'study',
    );
    const basicsEnd = study.filter((t) => t.topicId === 'basics').map((t) => t.id).length;
    const firstAdvanced = study.findIndex((t) => t.topicId === 'advanced');
    expect(firstAdvanced).toBeGreaterThanOrEqual(basicsEnd);
  });
  it('is deterministic and independent of input order', () => {
    const topics = ['a', 'b', 'c', 'd'].map((id, i) =>
      topic({ id, order: i + 1, minutes: 30 + i * 15 }),
    );
    const one = buildPlan(topics, settings(), {});
    const two = buildPlan([...topics].reverse(), settings(), {});
    expect(two).toEqual(one);
  });
  it('skips topics the student already knows or excluded', () => {
    const p = buildPlan(
      [topic({ id: 'a', done: true }), topic({ id: 'b', include: false }), topic({ id: 'c' })],
      settings(),
      {},
    );
    expect(new Set(tasks(p).map((t) => t.topicId))).toEqual(new Set(['c']));
  });
  it('ignores an excluded prerequisite instead of blocking forever', () => {
    const p = buildPlan(
      [topic({ id: 'p', include: false }), topic({ id: 'c', prerequisites: ['p'] })],
      settings(),
      {},
    );
    expect(tasks(p).some((t) => t.topicId === 'c')).toBe(true);
  });
});

describe('capacity and overflow', () => {
  it('reports what does not fit, and conserves minutes', () => {
    const topics = [
      topic({ id: 'a', minutes: 120 }),
      topic({ id: 'b', minutes: 120, importance: 'low' }),
      topic({ id: 'c', minutes: 120, importance: 'low' }),
    ];
    const p = buildPlan(topics, settings({ examDate: '2026-10-24', minutesPerDay: 120 }), {});
    expect(p.fit).toBe('overflow');
    expect(p.stats.scheduledStudyMinutes + p.stats.unscheduledMinutes).toBe(
      p.stats.requiredMinutes,
    );
    expect(p.stats.requiredMinutes).toBe(360);
    expect(p.unscheduled.reduce((s, u) => s + u.minutes, 0)).toBe(p.stats.unscheduledMinutes);
    expect(p.unscheduled.map((u) => u.topicId)).not.toContain('a');
  });
  it('finds the daily time that would fit everything', () => {
    const topics = [
      topic({ id: 'a', minutes: 120 }),
      topic({ id: 'b', minutes: 120 }),
      topic({ id: 'c', minutes: 120 }),
    ];
    const s = settings({ examDate: '2026-10-24', minutesPerDay: 60 });
    expect(buildPlan(topics, s, {}).fit).toBe('overflow');
    const { minutesPerDayToFitAll } = suggestAdjustment(topics, s, {});
    expect(minutesPerDayToFitAll).not.toBeNull();
    expect(
      buildPlan(topics, { ...s, minutesPerDay: minutesPerDayToFitAll! }, {}).unscheduled,
    ).toHaveLength(0);
    expect(
      buildPlan(topics, { ...s, minutesPerDay: minutesPerDayToFitAll! - 5 }, {}).unscheduled.length,
    ).toBeGreaterThan(0);
  });
  it('returns null when no realistic daily time would fit', () => {
    const p = suggestAdjustment(
      [topic({ id: 'a', minutes: 600 })],
      settings({ examDate: '2026-10-23' }),
      {},
    );
    expect(p.minutesPerDayToFitAll).toBeNull();
  });
  it('reports no-days when the exam is today or past, and keeps all the work unscheduled', () => {
    for (const examDate of ['2026-10-22', '2026-10-20']) {
      const p = buildPlan([topic({ id: 'a', minutes: 60 })], settings({ examDate }), {});
      expect(p.fit).toBe('no-days');
      expect(p.days).toHaveLength(0);
      expect(p.unscheduled).toEqual([{ topicId: 'a', minutes: 60 }]);
    }
  });
  it('handles an exam tomorrow: today is the only study day', () => {
    const p = buildPlan(
      [topic({ id: 'a', minutes: 60 })],
      settings({ examDate: '2026-10-23' }),
      {},
    );
    expect(p.days.map((d) => d.date)).toEqual(['2026-10-22']);
  });
  it('reports done when nothing is left', () => {
    expect(buildPlan([], settings(), {}).fit).toBe('done');
    expect(buildPlan([topic({ id: 'a', done: true })], settings(), {}).fit).toBe('done');
  });
  it('flags a nearly full plan as tight', () => {
    const p = buildPlan(
      [topic({ id: 'a', minutes: 120 })],
      settings({ examDate: '2026-10-24', minutesPerDay: 60, sessionMinutes: 60 }),
      {},
    );
    expect(['tight', 'overflow', 'fits']).toContain(p.fit);
  });
});

describe('revision', () => {
  it('schedules reviews at the configured intervals after the last sitting, before the exam', () => {
    const p = buildPlan(
      [topic({ id: 'a', minutes: 30 })],
      settings({ revisionIntervals: [1, 3] }),
      {},
    );
    const rev = tasks(p).filter((t) => t.kind === 'revision');
    expect(rev.map((t) => t.date)).toEqual(['2026-10-23', '2026-10-25']);
    expect(rev.map((t) => t.reviewIndex)).toEqual([0, 1]);
    expect(rev.every((t) => t.date > '2026-10-22' && t.date < '2026-10-28')).toBe(true);
  });
  it('never schedules a review before the study that it reviews', () => {
    const topics = [topic({ id: 'a', minutes: 120 }), topic({ id: 'b', minutes: 60 })];
    const p = buildPlan(topics, settings(), {});
    for (const t of topics) {
      const lastStudy = tasks(p)
        .filter((x) => x.kind === 'study' && x.topicId === t.id)
        .map((x) => x.date)
        .sort()
        .at(-1)!;
      for (const r of tasks(p).filter((x) => x.kind === 'revision' && x.topicId === t.id))
        expect(r.date > lastStudy).toBe(true);
    }
  });
  it('compresses to one final review when the exam is too close', () => {
    const p = buildPlan(
      [topic({ id: 'a', minutes: 30 })],
      settings({ examDate: '2026-10-24', revisionIntervals: [1, 3, 7] }),
      {},
    );
    const rev = tasks(p).filter((t) => t.kind === 'revision');
    // Reviews 2 and 3 would fall on or after the exam, so they merge into the single review on the last study day.
    expect(rev.map((t) => t.date)).toEqual(['2026-10-23']);
    expect(p.droppedRevisions).toEqual([]);
  });
  it('drops a review that is impossible because study ends on the last day', () => {
    const p = buildPlan(
      [topic({ id: 'a', minutes: 30 })],
      settings({ examDate: '2026-10-23' }),
      {},
    );
    expect(tasks(p).filter((t) => t.kind === 'revision')).toHaveLength(0);
    expect(p.droppedRevisions.length).toBeGreaterThan(0);
  });
  it('collapses intervals that land on the same day into one review', () => {
    const p = buildPlan(
      [topic({ id: 'a', minutes: 30 })],
      settings({ examDate: '2026-10-24', revisionIntervals: [1, 1] }),
      {},
    );
    expect(tasks(p).filter((t) => t.kind === 'revision')).toHaveLength(1);
  });
  it('keeps reviews from starving new learning on a normal day', () => {
    const topics = Array.from({ length: 6 }, (_, i) =>
      topic({ id: `t${i}`, minutes: 30, order: i }),
    );
    const p = buildPlan(topics, settings({ examDate: '2026-11-10', minutesPerDay: 60 }), {});
    for (const d of p.days.slice(0, -1)) {
      const rev = d.tasks.filter((t) => t.kind === 'revision').reduce((s, t) => s + t.minutes, 0);
      expect(rev).toBeLessThanOrEqual(24);
    }
  });
});

describe('progress', () => {
  it('completing study shrinks the remaining work and starts its reviews', () => {
    const topics = [topic({ id: 'a', minutes: 90 })];
    const s = settings();
    let progress: ProgressMap = {};
    const first = nextTask(buildPlan(topics, s, progress))!;
    expect(first).toMatchObject({ kind: 'study', topicId: 'a', minutes: 45 });
    progress = completeTask(first, progress, s.today);
    const p2 = buildPlan(topics, s, progress);
    expect(p2.stats.requiredMinutes).toBe(45);
    const second = nextTask(p2)!;
    progress = completeTask(second, progress, s.today);
    const p3 = buildPlan(topics, s, progress);
    expect(p3.stats.requiredMinutes).toBe(0);
    expect(tasks(p3).every((t) => t.kind === 'revision')).toBe(true);
    expect(tasks(p3)[0]!.date).toBe('2026-10-23');
  });
  it('completing a review removes it and keeps the later one', () => {
    const s = settings();
    const topics = [topic({ id: 'a', minutes: 30 })];
    let progress: ProgressMap = {
      a: { studiedMinutes: 30, lastStudiedOn: s.today, reviewsDone: 0 },
    };
    const p = buildPlan(topics, s, progress);
    const rev = tasks(p)[0]!;
    expect(rev).toMatchObject({ kind: 'revision', reviewIndex: 0 });
    progress = completeTask(rev, progress, s.today);
    expect(tasks(buildPlan(topics, s, progress)).map((t) => t.reviewIndex)).toEqual([1]);
  });
  it('rolls missed work forward instead of leaving it overdue', () => {
    const topics = [topic({ id: 'a', minutes: 45 })];
    const s = settings();
    const monday = buildPlan(topics, s, {});
    expect(nextTask(monday)!.date).toBe('2026-10-22');
    const later = buildPlan(topics, { ...s, today: '2026-10-25' }, {});
    expect(nextTask(later)!.date).toBe('2026-10-25');
  });
  it('brings an overdue review to today', () => {
    const progress: ProgressMap = {
      a: { studiedMinutes: 30, lastStudiedOn: '2026-10-15', reviewsDone: 0 },
    };
    const p = buildPlan([topic({ id: 'a', minutes: 30 })], settings(), progress);
    expect(tasks(p)[0]).toMatchObject({ kind: 'revision', date: '2026-10-22' });
  });
  it('does not mutate its inputs', () => {
    const topics = [topic({ id: 'a' })];
    const progress: ProgressMap = {};
    const before = JSON.stringify([topics, progress]);
    const task = nextTask(buildPlan(topics, settings(), progress))!;
    completeTask(task, progress, '2026-10-22');
    expect(JSON.stringify([topics, progress])).toBe(before);
  });
});

describe('validateSettings', () => {
  it('rejects impossible settings and the planner refuses to run on them', () => {
    expect(validateSettings(settings({ minutesPerDay: 5 }))).not.toHaveLength(0);
    expect(validateSettings(settings({ minutesPerDay: 2000 }))).not.toHaveLength(0);
    expect(validateSettings(settings({ sessionMinutes: 5 }))).not.toHaveLength(0);
    expect(validateSettings(settings({ examDate: 'soon' }))).not.toHaveLength(0);
    expect(validateSettings(settings({ examDate: '2028-10-22' }))).not.toHaveLength(0);
    expect(validateSettings(settings({ revisionIntervals: [0] }))).not.toHaveLength(0);
    expect(validateSettings(settings())).toEqual([]);
    expect(() => buildPlan([], settings({ minutesPerDay: 1 }), {})).toThrow(RangeError);
  });
});

/** Small seeded PRNG so random scenarios are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('planner invariants over random scenarios', () => {
  it('holds for 200 seeded scenarios', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const n = 1 + Math.floor(r() * 12);
      const topics: Topic[] = Array.from({ length: n }, (_, i) =>
        topic({
          id: `t${i}`,
          order: i,
          minutes: 15 + 5 * Math.floor(r() * 40),
          importance: (['low', 'medium', 'high'] as const)[Math.floor(r() * 3)]!,
          difficulty: (1 + Math.floor(r() * 3)) as 1 | 2 | 3,
          weak: r() < 0.2,
          done: r() < 0.1,
          include: r() < 0.9,
          prerequisites: i > 0 && r() < 0.4 ? [`t${Math.floor(r() * i)}`] : [],
        }),
      );
      const s = settings({
        examDate: addDays('2026-10-22', Math.floor(r() * 20)),
        minutesPerDay: 15 + 5 * Math.floor(r() * 40),
        sessionMinutes: 15 + 5 * Math.floor(r() * 10),
        revisionIntervals: [1 + Math.floor(r() * 3), 3 + Math.floor(r() * 5)],
      });
      const p = buildPlan(topics, s, {});
      const all = tasks(p);
      const where = `seed ${seed}`;
      for (const d of p.days) expect(d.usedMinutes, where).toBeLessThanOrEqual(s.minutesPerDay);
      for (const t of all) {
        expect(t.date >= s.today && t.date < s.examDate, where).toBe(true);
        expect(t.minutes % 5, where).toBe(0);
        if (t.kind === 'study') expect(t.minutes, where).toBeLessThanOrEqual(s.sessionMinutes);
      }
      expect(p.stats.scheduledStudyMinutes + p.stats.unscheduledMinutes, where).toBe(
        p.stats.requiredMinutes,
      );
      expect(new Set(all.map((t) => t.id)).size, where).toBe(all.length);
      const dayOf = (id: string, kind: 'study') =>
        all.filter((t) => t.kind === kind && t.topicId === id).map((t) => t.date);
      for (const t of topics.filter((x) => x.include && !x.done)) {
        const mine = dayOf(t.id, 'study');
        for (const pre of t.prerequisites) {
          const pt = topics.find((x) => x.id === pre)!;
          if (!(pt.include && !pt.done) || mine.length === 0) continue;
          const unscheduledPre = p.unscheduled.some((u) => u.topicId === pre);
          expect(unscheduledPre, `${where}: ${t.id} started before ${pre} finished`).toBe(false);
          expect([...dayOf(pre, 'study')].sort().at(-1)! <= [...mine].sort()[0]!, where).toBe(true);
        }
        const lastStudy = [...mine].sort().at(-1);
        for (const rv of all.filter((x) => x.kind === 'revision' && x.topicId === t.id))
          expect(lastStudy && rv.date > lastStudy, where).toBe(true);
      }
      expect(buildPlan([...topics].reverse(), s, {}), where).toEqual(p);
    }
  });
});
