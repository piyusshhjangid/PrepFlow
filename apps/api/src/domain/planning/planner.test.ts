import { describe, expect, it } from 'vitest';
import { config, historyTask, topics } from './fixtures.js';
import { generatePlan } from './planner.js';
import { recoverMissedTasks } from './recover.js';
import { buildCalendar } from './capacity.js';
import type { HistoryTask, PlanConfig, PlanTopic, TaskDraft } from './types.js';

const gen = (
  t: PlanTopic[],
  c: PlanConfig = config(),
  extra: { history?: HistoryTask[]; includeSkipped?: boolean } = {},
) => generatePlan({ topics: t, config: c, ...extra });
const sum = (tasks: TaskDraft[], pick: (t: TaskDraft) => boolean = () => true) =>
  tasks.filter(pick).reduce((a, t) => a + t.minutes, 0);
const asHistory = (tasks: TaskDraft[]): HistoryTask[] =>
  tasks.map((t, i) => ({ ...t, id: `p${i}` }));
const firstDate = (tasks: TaskDraft[], id: string, type: 'STUDY' | 'REVISION' = 'STUDY') =>
  tasks
    .filter((t) => t.topicId === id && t.type === type)
    .map((t) => t.date)
    .sort()[0];
const lastDate = (tasks: TaskDraft[], id: string) =>
  tasks
    .filter((t) => t.topicId === id && t.type === 'STUDY')
    .map((t) => t.date)
    .sort()
    .at(-1);

const dbms = () =>
  topics({
    basics: { importance: 'HIGH', estimatedMinutes: 60 },
    sql: { importance: 'MEDIUM', estimatedMinutes: 45, prerequisiteIds: ['basics'] },
    normalization: {
      importance: 'HIGH',
      isWeak: true,
      difficulty: 'HARD',
      estimatedMinutes: 90,
      prerequisiteIds: ['basics'],
    },
    transactions: { importance: 'MEDIUM', estimatedMinutes: 60, prerequisiteIds: ['sql'] },
    indexing: { importance: 'LOW', estimatedMinutes: 40 },
  });

describe('generatePlan', () => {
  it('schedules everything when time is plentiful and reports a GOOD fit', () => {
    const out = gen(dbms());
    expect(out.summary.fit.status).toBe('GOOD');
    expect(out.summary.fit.deferredStudyMinutes).toBe(0);
    expect(sum(out.tasks, (t) => t.type === 'STUDY')).toBe(60 + 45 + 90 + 60 + 40);
    expect(out.summary.fit.headline).toMatch(/fits/);
  });

  it('never exceeds a day’s usable capacity (buffer is respected)', () => {
    const out = gen(dbms(), config({ minutesPerDay: 90 }));
    const usable = buildCalendar(config({ minutesPerDay: 90 }))[0]!.usable;
    const perDay = new Map<string, number>();
    for (const t of out.tasks) perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.minutes);
    for (const m of perDay.values()) expect(m).toBeLessThanOrEqual(usable);
  });

  it('puts prerequisites before dependents', () => {
    const out = gen(dbms());
    expect(lastDate(out.tasks, 'basics')! <= firstDate(out.tasks, 'sql')!).toBe(true);
    expect(lastDate(out.tasks, 'basics')! <= firstDate(out.tasks, 'normalization')!).toBe(true);
    expect(lastDate(out.tasks, 'sql')! <= firstDate(out.tasks, 'transactions')!).toBe(true);
  });

  it('studies the more important weak topic before the unimportant one', () => {
    const out = gen(dbms());
    expect(firstDate(out.tasks, 'normalization')! <= firstDate(out.tasks, 'indexing')!).toBe(true);
    const norm = out.summary.topics.find((t) => t.topicId === 'normalization')!;
    expect(norm.level).toBe('HIGH');
    expect(norm.reasons.some((r) => r.code === 'WEAK')).toBe(true);
  });

  it('is deterministic: the same inputs give an identical plan', () => {
    const a = gen(dbms());
    const b = gen([...dbms()].reverse());
    expect(b).toEqual(a);
    expect(gen(dbms())).toEqual(a);
  });

  it('breaks priority ties by document order, deterministically', () => {
    const t = topics({ x: {}, y: {}, z: {} });
    const out = gen(t, config({ minutesPerDay: 80, examDate: '2026-10-12' }));
    const order = out.tasks.filter((x) => x.type === 'STUDY').map((x) => x.topicId);
    expect(order[0]).toBe('x');
  });

  it('splits a long topic across days and numbers the parts', () => {
    const out = gen(topics({ big: { estimatedMinutes: 240 } }), config({ minutesPerDay: 120 }));
    const parts = out.tasks.filter((t) => t.type === 'STUDY');
    expect(parts.length).toBeGreaterThan(1);
    expect(sum(parts)).toBe(240);
    expect(parts.every((p) => p.minutes <= 60)).toBe(true);
    expect(parts.map((p) => p.partIndex)).toEqual(parts.map((_, i) => i + 1));
    expect(parts.every((p) => p.partCount === parts.length)).toBe(true);
    expect(new Set(parts.map((p) => p.date)).size).toBe(parts.length); // one sitting per day
  });

  it('carries evidence, reasons and prerequisites in the explanation', () => {
    const out = gen(dbms());
    const sql = out.summary.topics.find((t) => t.topicId === 'sql')!;
    expect(sql.prerequisites).toEqual([{ id: 'basics', name: 'BASICS' }]);
    expect(sql.evidence).toEqual({ materialName: 'notes.pdf', page: 3, pageEnd: 3 });
    const basics = out.summary.topics.find((t) => t.topicId === 'basics')!;
    expect(basics.directDependents).toBe(2);
    expect(basics.reasons.some((r) => r.code === 'FOUNDATION')).toBe(true);
    const task = out.tasks.find((t) => t.topicId === 'basics' && t.type === 'STUDY')!;
    expect(task.reasons.length).toBeGreaterThan(0);
  });
});

describe('when the syllabus does not fit', () => {
  const many = () =>
    topics({
      core1: { importance: 'HIGH', isWeak: true, estimatedMinutes: 120 },
      core2: { importance: 'HIGH', estimatedMinutes: 120, statedEmphasis: true },
      mid1: { importance: 'MEDIUM', estimatedMinutes: 90 },
      mid2: { importance: 'MEDIUM', estimatedMinutes: 90 },
      low1: { importance: 'LOW', difficulty: 'EASY', estimatedMinutes: 90 },
      low2: { importance: 'LOW', difficulty: 'EASY', estimatedMinutes: 90 },
    });
  const tight = config({ examDate: '2026-10-08', minutesPerDay: 180 }); // 3 days, 140 study min each = 420

  it('reports OVER_CAPACITY with the gap, and defers the lowest-priority topics', () => {
    const out = gen(many(), tight);
    const fit = out.summary.fit;
    expect(fit.status).toBe('OVER_CAPACITY');
    expect(fit.requiredStudyMinutes).toBe(600);
    expect(fit.capacityGapMinutes).toBeGreaterThan(0);
    expect(fit.deferredStudyMinutes).toBeGreaterThan(0);
    expect(fit.headline).toMatch(/does not fit/i);
    const deferred = out.summary.topics.filter((t) => t.tier === 'DEFER').map((t) => t.topicId);
    expect(deferred.length).toBeGreaterThan(0);
    expect(deferred.every((id) => id.startsWith('low') || id.startsWith('mid'))).toBe(true);
    expect(out.summary.warnings.some((w) => w.code === 'OVER_CAPACITY')).toBe(true);
  });

  it('protects high-priority topics: they are scheduled in full and tiered MUST', () => {
    const out = gen(many(), tight);
    expect(out.summary.topics.find((t) => t.topicId === 'core1')!.tier).toBe('MUST');
    for (const id of ['core1', 'core2']) {
      const insight = out.summary.topics.find((t) => t.topicId === id)!;
      expect(['MUST', 'SHOULD']).toContain(insight.tier);
      expect(insight.scheduledMinutes).toBe(insight.requiredMinutes);
    }
  });

  it('every deferred topic has an explanation and no tasks', () => {
    const out = gen(many(), tight);
    for (const t of out.summary.topics.filter(
      (x) => x.tier === 'DEFER' && x.scheduledMinutes === 0,
    )) {
      expect(t.placement).toMatch(/Deferred|Not scheduled/);
      expect(out.tasks.some((x) => x.topicId === t.topicId)).toBe(false);
    }
  });

  it('scheduled + deferred study minutes equal the required minutes', () => {
    const { fit } = gen(many(), tight).summary;
    expect(fit.scheduledStudyMinutes + fit.deferredStudyMinutes).toBe(fit.requiredStudyMinutes);
  });

  it('a dependent stays unscheduled when its oversized prerequisite cannot finish in time', () => {
    const t = topics({
      root: { importance: 'LOW', estimatedMinutes: 200 },
      leaf: { importance: 'HIGH', isWeak: true, estimatedMinutes: 100, prerequisiteIds: ['root'] },
    });
    const out = gen(t, config({ examDate: '2026-10-08' }));
    const root = out.summary.topics.find((x) => x.topicId === 'root')!;
    const leaf = out.summary.topics.find((x) => x.topicId === 'leaf')!;
    // The prerequisite needs more sittings than this short window allows; the dependent must wait.
    expect(root.scheduledMinutes).toBeLessThan(200);
    expect(leaf.scheduledMinutes).toBe(0);
    expect(firstDate(out.tasks, 'leaf')).toBeUndefined();
    expect(root.tier).toBe('DEFER');
    expect(leaf.tier).toBe('DEFER');
  });

  it('skipping the prerequisite chain is impossible: a dependent starts only after prerequisites finish', () => {
    const t = topics({
      a: { estimatedMinutes: 100 },
      b: { estimatedMinutes: 100, prerequisiteIds: ['a'] },
    });
    const out = gen(t, config({ examDate: '2026-10-07', minutesPerDay: 90 }));
    const aEnd = lastDate(out.tasks, 'a');
    const bStart = firstDate(out.tasks, 'b');
    if (bStart) expect(aEnd! <= bStart).toBe(true);
  });
});

describe('revision', () => {
  it('schedules spaced reviews after studying, never after the last study day', () => {
    const out = gen(topics({ a: { importance: 'HIGH' } }), config({ examDate: '2026-10-25' }));
    const reviews = out.tasks.filter((t) => t.type === 'REVISION');
    expect(reviews).toHaveLength(3);
    const studied = lastDate(out.tasks, 'a')!;
    expect(reviews.map((r) => r.date)).toEqual(['2026-10-06', '2026-10-08', '2026-10-12']);
    expect(studied).toBe('2026-10-05');
    expect(reviews.map((r) => r.revisionIndex)).toEqual([1, 2, 3]);
    for (const r of reviews) expect(r.date < '2026-10-25').toBe(true);
  });

  it('with 2 days left there is no +7 day review; intervals that do not fit are dropped', () => {
    const out = gen(topics({ a: { importance: 'HIGH' } }), config({ examDate: '2026-10-07' }));
    const reviews = out.tasks.filter((t) => t.type === 'REVISION');
    expect(reviews.length).toBeLessThanOrEqual(1);
    for (const r of reviews) expect(r.date <= '2026-10-06').toBe(true);
    expect(sum(out.tasks, (t) => t.type === 'STUDY')).toBe(60);
  });

  it('with one study day left there is no revision at all (nothing is scheduled after studying)', () => {
    const out = gen(topics({ a: { estimatedMinutes: 60 } }), config({ examDate: '2026-10-06' }));
    expect(out.tasks.filter((t) => t.type === 'REVISION')).toHaveLength(0);
  });

  it('never schedules any task on or after the exam date', () => {
    for (const examDate of ['2026-10-06', '2026-10-07', '2026-10-09', '2026-10-20', '2026-11-30']) {
      const out = gen(dbms(), config({ examDate }));
      for (const t of out.tasks) expect(t.date < examDate).toBe(true);
    }
  });

  it('skips unavailable days when snapping revision dates', () => {
    const out = gen(
      topics({ a: {} }),
      config({ examDate: '2026-10-25', blockedDates: ['2026-10-06'] }),
    );
    const reviews = out.tasks.filter((t) => t.type === 'REVISION');
    expect(reviews.every((r) => r.date !== '2026-10-06')).toBe(true);
    expect(reviews[0]!.date).toBe('2026-10-07');
  });

  it('weak, hard topics get longer reviews than easy ones', () => {
    const out = gen(
      topics({
        hard: { revisionWeight: 1, estimatedMinutes: 90 },
        easy: { revisionWeight: 0.1, estimatedMinutes: 90 },
      }),
      config({ examDate: '2026-10-25', minutesPerDay: 360 }),
    );
    const first = (id: string) =>
      out.tasks.find((t) => t.topicId === id && t.type === 'REVISION')!.minutes;
    expect(first('hard')).toBeGreaterThan(first('easy'));
  });

  it('deferred topics get no revision', () => {
    const out = gen(
      topics({
        big: { estimatedMinutes: 240 },
        other: { estimatedMinutes: 240, importance: 'LOW' },
      }),
      config({ examDate: '2026-10-06' }),
    );
    const deferred = out.summary.topics.filter((t) => t.tier === 'DEFER').map((t) => t.topicId);
    for (const id of deferred)
      expect(out.tasks.some((t) => t.topicId === id && t.type === 'REVISION')).toBe(false);
  });
});

describe('edge cases', () => {
  it('no topics: empty plan with a clear warning', () => {
    const out = gen([]);
    expect(out.tasks).toEqual([]);
    expect(out.summary.warnings.map((w) => w.code)).toContain('NO_TOPICS');
  });

  it('one topic', () => {
    const out = gen(topics({ only: {} }));
    expect(out.summary.fit.status).toBe('GOOD');
    expect(out.tasks.some((t) => t.type === 'STUDY')).toBe(true);
  });

  it('a huge topic larger than the whole window is partly scheduled and flagged', () => {
    const out = gen(
      topics({ huge: { estimatedMinutes: 1000 } }),
      config({ examDate: '2026-10-08' }),
    );
    expect(out.summary.fit.status).toBe('OVER_CAPACITY');
    expect(out.summary.topics[0]!.scheduledMinutes).toBeGreaterThan(0);
    expect(out.summary.topics[0]!.scheduledMinutes).toBeLessThan(1000);
  });

  it('exam today / in the past: nothing scheduled, NO_CAPACITY, never throws', () => {
    for (const examDate of ['2026-10-05', '2026-10-01']) {
      const out = gen(dbms(), config({ examDate }));
      expect(out.tasks).toEqual([]);
      expect(out.summary.fit.status).toBe('NO_CAPACITY');
      expect(
        out.summary.warnings.some((w) => w.code === 'EXAM_TODAY' || w.code === 'EXAM_PASSED'),
      ).toBe(true);
    }
  });

  it('exam tomorrow: only today is available', () => {
    const out = gen(dbms(), config({ examDate: '2026-10-06' }));
    expect(new Set(out.tasks.map((t) => t.date))).toEqual(new Set(['2026-10-05']));
    expect(out.summary.fit.status).toBe('OVER_CAPACITY');
  });

  it('all days unavailable: NO_CAPACITY with a warning', () => {
    const out = gen(dbms(), config({ studyWeekdays: [] }));
    expect(out.tasks).toEqual([]);
    expect(out.summary.fit.status).toBe('NO_CAPACITY');
    expect(out.summary.warnings.some((w) => w.code === 'NO_STUDY_DAYS')).toBe(true);
  });

  it('zero study minutes and other invalid input are rejected, not planned', () => {
    expect(() => gen(dbms(), config({ minutesPerDay: 0 }))).toThrow();
    expect(() => gen(dbms(), config({ minutesPerDay: -10 }))).toThrow();
    expect(() => gen(dbms(), config({ examDate: '2026-13-40' }))).toThrow();
    expect(() => gen(dbms(), config({ today: 'tomorrow' }))).toThrow();
    expect(() => gen(topics({ a: { estimatedMinutes: -5 } }))).toThrow();
    expect(() => gen(topics({ a: { estimatedMinutes: 99999 } }))).toThrow();
    expect(() => gen([...topics({ a: {} }), ...topics({ a: {} })])).toThrow();
  });

  it('unavailable weekdays are never used', () => {
    const out = gen(dbms(), config({ studyWeekdays: [1, 2, 3, 4, 5, 6], examDate: '2026-10-20' }));
    for (const t of out.tasks) expect(new Date(`${t.date}T00:00:00Z`).getUTCDay()).not.toBe(0);
  });

  it('refuses more than the maximum number of topics', () => {
    const lots = Array.from({ length: 601 }, (_, i) => topics({ [`t${i}`]: {} })[0]!).map(
      (t, i) => ({ ...t, order: i }),
    );
    expect(() => gen(lots)).toThrow(/at most/);
  });

  it('handles 500 topics comfortably', () => {
    const big = Array.from({ length: 500 }, (_, i) => ({
      ...topics({
        x: {
          estimatedMinutes: 30 + (i % 6) * 15,
          importance: (['LOW', 'MEDIUM', 'HIGH'] as const)[i % 3],
        },
      })[0]!,
      id: `t${String(i).padStart(3, '0')}`,
      name: `T${i}`,
      order: i,
      prerequisiteIds: i > 3 && i % 4 === 0 ? [`t${String(i - 3).padStart(3, '0')}`] : [],
    }));
    const started = Date.now();
    const out = gen(big, config({ examDate: '2027-03-01', minutesPerDay: 360 }));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(out.tasks.length).toBeGreaterThan(300);
  });

  it('surfaces a prerequisite cycle as a warning and still plans', () => {
    const t = topics({
      a: { prerequisiteIds: ['c'] },
      b: { prerequisiteIds: ['a'] },
      c: { prerequisiteIds: ['b'] },
    });
    const out = gen(t);
    expect(out.summary.graph.cyclesBroken).toBe(1);
    expect(out.summary.warnings.some((w) => w.code === 'CYCLE_BROKEN')).toBe(true);
    expect(sum(out.tasks, (x) => x.type === 'STUDY')).toBe(180);
    expect(lastDate(out.tasks, 'a')! <= firstDate(out.tasks, 'b')!).toBe(true);
    expect(lastDate(out.tasks, 'b')! <= firstDate(out.tasks, 'c')!).toBe(true);
  });

  it('every task references an existing topic', () => {
    const t = dbms();
    const ids = new Set(t.map((x) => x.id));
    for (const task of gen(t).tasks) expect(ids.has(task.topicId!)).toBe(true);
  });
});

describe('regeneration (re-plan the remaining work)', () => {
  const base = () => {
    const first = gen(dbms(), config({ examDate: '2026-10-20' }));
    return asHistory(first.tasks);
  };

  it('keeps completed tasks exactly as they were and re-plans the rest', () => {
    const history = base();
    const done = history
      .filter((t) => t.type === 'STUDY')
      .slice(0, 2)
      .map((t) => ({
        ...t,
        status: 'COMPLETED' as const,
        completedAt: '2026-10-05T10:00:00.000Z',
        actualMinutes: 50,
      }));
    const rest = history.filter((t) => !done.some((d) => d.id === t.id));
    const next = gen(dbms(), config({ today: '2026-10-07', examDate: '2026-10-20' }), {
      history: [...done, ...rest],
    });
    for (const d of done) {
      const kept = next.tasks.find((t) => t.carriedFromTaskId === d.id)!;
      expect(kept).toBeDefined();
      expect(kept.status).toBe('COMPLETED');
      expect(kept.date).toBe(d.date);
      expect(kept.minutes).toBe(d.minutes);
      expect(kept.completedAt).toBe(d.completedAt);
      expect(kept.actualMinutes).toBe(50);
    }
    // nothing pending is left in the past
    expect(
      next.tasks.filter((t) => t.status === 'PENDING').every((t) => t.date >= '2026-10-07'),
    ).toBe(true);
  });

  it('does not schedule study work that is already completed again', () => {
    const history = base().map((t) =>
      t.type === 'STUDY' ? { ...t, status: 'COMPLETED' as const } : t,
    );
    const next = gen(dbms(), config({ today: '2026-10-08', examDate: '2026-10-20' }), { history });
    expect(next.tasks.filter((t) => t.type === 'STUDY' && t.status === 'PENDING')).toHaveLength(0);
    expect(next.summary.fit.requiredStudyMinutes).toBe(0);
  });

  it('missed (pending, past) work is planned again from today', () => {
    const history = base(); // everything still PENDING; "today" is now 4 days later
    const next = gen(dbms(), config({ today: '2026-10-09', examDate: '2026-10-20' }), { history });
    expect(next.summary.fit.requiredStudyMinutes).toBe(60 + 45 + 90 + 60 + 40);
    expect(next.tasks.every((t) => t.date >= '2026-10-09')).toBe(true);
  });

  it('skipped work stays skipped unless includeSkipped is set', () => {
    const history = base().map((t) =>
      t.topicId === 'indexing' && t.type === 'STUDY' ? { ...t, status: 'SKIPPED' as const } : t,
    );
    const cfg = config({ today: '2026-10-07', examDate: '2026-10-20' });
    const without = gen(dbms(), cfg, { history });
    expect(without.summary.topics.find((t) => t.topicId === 'indexing')!.requiredMinutes).toBe(0);
    const withSkipped = gen(dbms(), cfg, { history, includeSkipped: true });
    expect(withSkipped.summary.topics.find((t) => t.topicId === 'indexing')!.requiredMinutes).toBe(
      40,
    );
  });

  it('continues revision numbering after completed reviews', () => {
    const history = base();
    const study = history
      .filter((t) => t.topicId === 'basics' && t.type === 'STUDY')
      .map((t) => ({ ...t, status: 'COMPLETED' as const }));
    const review1 = history
      .filter((t) => t.topicId === 'basics' && t.type === 'REVISION' && t.revisionIndex === 1)
      .map((t) => ({ ...t, status: 'COMPLETED' as const }));
    const others = history.filter((t) => t.topicId !== 'basics');
    const next = gen(dbms(), config({ today: '2026-10-07', examDate: '2026-10-20' }), {
      history: [...study, ...review1, ...others],
    });
    const open = next.tasks.filter(
      (t) => t.topicId === 'basics' && t.type === 'REVISION' && t.status === 'PENDING',
    );
    expect(open.every((t) => (t.revisionIndex ?? 0) >= 2)).toBe(true);
  });

  it('is deterministic for the same history', () => {
    const history = base();
    const cfg = config({ today: '2026-10-07', examDate: '2026-10-20' });
    expect(gen(dbms(), cfg, { history })).toEqual(gen(dbms(), cfg, { history }));
  });

  it('keeps tasks whose topic no longer exists (history survives re-analysis)', () => {
    const history = base();
    const orphan = { ...history[0]!, topicId: null, status: 'COMPLETED' as const };
    const next = gen(dbms(), config({ today: '2026-10-07', examDate: '2026-10-20' }), {
      history: [orphan],
    });
    expect(next.tasks.some((t) => t.carriedFromTaskId === orphan.id && t.topicId === null)).toBe(
      true,
    );
  });
});

describe('missed-task recovery', () => {
  const planThenMiss = () => {
    const t = topics({
      a: { estimatedMinutes: 60 },
      b: { estimatedMinutes: 60 },
      c: { estimatedMinutes: 60 },
    });
    const first = gen(t, config({ examDate: '2026-10-20', minutesPerDay: 120 }));
    return { t, history: asHistory(first.tasks) };
  };

  it('moves missed tasks into spare time, keeps the rest in place, and reports the moves', () => {
    const { t, history } = planThenMiss();
    const cfg = config({ today: '2026-10-07', examDate: '2026-10-20', minutesPerDay: 120 });
    const missed = history.filter((h) => h.date < '2026-10-07' && h.status === 'PENDING');
    expect(missed.length).toBeGreaterThan(0);
    const out = recoverMissedTasks({ tasks: history, topics: t, config: cfg });
    expect(out.report.missedTasks).toBe(missed.length);
    expect(out.report.recoveredMinutes + out.report.overloadMinutes).toBe(out.report.missedMinutes);
    expect(out.report.overloadMinutes).toBe(0);
    expect(out.tasks.filter((x) => x.status === 'PENDING' && x.date < '2026-10-07')).toHaveLength(
      0,
    );
    // unaffected future tasks keep their dates
    for (const h of history.filter((x) => x.date >= '2026-10-07')) {
      expect(
        out.tasks.some(
          (x) => x.carriedFromTaskId === h.id && x.date === h.date && x.minutes === h.minutes,
        ),
      ).toBe(true);
    }
    expect(out.report.moves.every((m) => m.to >= '2026-10-07' && m.from < '2026-10-07')).toBe(true);
  });

  it('never loads a day beyond its usable minutes when there is room', () => {
    const { t, history } = planThenMiss();
    const cfg = config({ today: '2026-10-07', examDate: '2026-10-20', minutesPerDay: 120 });
    const out = recoverMissedTasks({ tasks: history, topics: t, config: cfg });
    const usable = buildCalendar(cfg)[0]!.usable;
    const load = new Map<string, number>();
    for (const x of out.tasks.filter((y) => y.date >= '2026-10-07' && y.status !== 'SKIPPED'))
      load.set(x.date, (load.get(x.date) ?? 0) + x.minutes);
    for (const v of load.values()) expect(v).toBeLessThanOrEqual(usable);
  });

  it('splits a missed task across days when no single day has room', () => {
    const cfg = config({ today: '2026-10-07', examDate: '2026-10-09', minutesPerDay: 100 }); // two tiny days
    const t = topics({ a: {} });
    const history = [
      historyTask({ id: 'm1', topicId: 'a', topicName: 'A', date: '2026-10-05', minutes: 120 }),
      historyTask({
        id: 'f1',
        topicId: 'a',
        topicName: 'A',
        date: '2026-10-07',
        minutes: 30,
        type: 'REVISION',
        revisionIndex: 1,
      }),
    ];
    const out = recoverMissedTasks({ tasks: history, topics: t, config: cfg });
    const pieces = out.tasks.filter((x) => x.carriedFromTaskId === 'm1');
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.reduce((a, p) => a + p.minutes, 0) + out.report.overloadMinutes).toBe(120);
  });

  it('reports overload instead of silently overfilling when recovery is impossible', () => {
    const cfg = config({
      today: '2026-10-07',
      examDate: '2026-10-08',
      minutesPerDay: 60,
      bufferPct: 0,
    });
    const t = topics({ a: {} });
    const history = [
      historyTask({ id: 'm1', topicId: 'a', date: '2026-10-05', minutes: 90 }),
      historyTask({
        id: 'f1',
        topicId: 'a',
        date: '2026-10-07',
        minutes: 45,
        type: 'REVISION',
        revisionIndex: 1,
      }),
    ];
    const out = recoverMissedTasks({ tasks: history, topics: t, config: cfg });
    expect(out.report.overloadMinutes).toBeGreaterThan(0);
    expect(out.warnings.some((w) => w.code === 'PLAN_OVERLOADED')).toBe(true);
    const todayLoad = out.tasks
      .filter((x) => x.date === '2026-10-07')
      .reduce((a, x) => a + x.minutes, 0);
    expect(todayLoad).toBeLessThanOrEqual(60);
    // what could not move stays visible as overdue
    expect(out.tasks.some((x) => x.status === 'PENDING' && x.date < '2026-10-07')).toBe(true);
  });

  it('uses the daily buffer only after planned time is exhausted', () => {
    const cfg = config({
      today: '2026-10-07',
      examDate: '2026-10-08',
      minutesPerDay: 100,
      bufferPct: 20,
    }); // usable 80
    const t = topics({ a: {} });
    const history = [historyTask({ id: 'm1', topicId: 'a', date: '2026-10-05', minutes: 90 })];
    const out = recoverMissedTasks({ tasks: history, topics: t, config: cfg });
    expect(out.report.recoveredMinutes).toBe(90);
    expect(out.report.usedBufferMinutes).toBeGreaterThan(0);
  });

  it('completed, skipped and in-progress tasks are never touched', () => {
    const cfg = config({ today: '2026-10-07', examDate: '2026-10-20' });
    const t = topics({ a: {} });
    const history = [
      historyTask({
        id: 'c1',
        date: '2026-10-05',
        status: 'COMPLETED',
        completedAt: '2026-10-05T09:00:00.000Z',
      }),
      historyTask({ id: 's1', date: '2026-10-05', status: 'SKIPPED' }),
      historyTask({ id: 'i1', date: '2026-10-06', status: 'IN_PROGRESS' }),
      historyTask({ id: 'p1', date: '2026-10-06', status: 'PENDING' }),
    ];
    const out = recoverMissedTasks({ tasks: history, topics: t, config: cfg });
    for (const id of ['c1', 's1', 'i1']) {
      const kept = out.tasks.find((x) => x.carriedFromTaskId === id)!;
      expect(kept.date).toBe(history.find((h) => h.id === id)!.date);
      expect(kept.status).toBe(history.find((h) => h.id === id)!.status);
    }
    expect(out.report.missedTasks).toBe(1);
  });

  it('is deterministic', () => {
    const { t, history } = planThenMiss();
    const cfg = config({ today: '2026-10-08', examDate: '2026-10-20', minutesPerDay: 120 });
    expect(recoverMissedTasks({ tasks: history, topics: t, config: cfg })).toEqual(
      recoverMissedTasks({ tasks: history, topics: t, config: cfg }),
    );
  });
});
