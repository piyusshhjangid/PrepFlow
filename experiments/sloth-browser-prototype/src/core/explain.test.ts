import { describe, expect, it } from 'vitest';
import { buildPlan, nextTask, type PlanSettings } from './planner';
import { explainTask, explainTopic, SOURCE_LABEL } from './explain';
import { loadSample } from '../demo/sample';
import { reducer, initialState } from '../ui/store';

const TODAY = '2026-10-24';
const settings: PlanSettings = {
  today: TODAY,
  examDate: '2026-10-30',
  minutesPerDay: 120,
  sessionMinutes: 45,
  revisionIntervals: [1, 3],
};
const bundle = loadSample(TODAY);
const topics = bundle.topics;
const byName = (n: string) => topics.find((t) => t.name === n)!;
const plan = buildPlan(topics, settings, {});

describe('explainTopic', () => {
  it('separates what the material says from what the model guessed and what code calculated', () => {
    const lines = explainTopic(byName('Aggregation'), topics, settings, {}, plan);
    const kinds = new Set(lines.map((l) => l.source));
    expect(kinds).toEqual(new Set(['material', 'model', 'code', 'caveat']));
    const quotes = lines.filter((l) => l.quote).map((l) => l.quote);
    expect(quotes).toContain(byName('Aggregation').evidence!.quote);
    expect(quotes).toContain('This topic carries 20 percent of the final exam.');
    // Quotes shown as "your material" really are in the material.
    for (const q of quotes) expect(bundle.material.text).toContain(q!);
  });
  it('says when importance was lowered because the material does not signal it', () => {
    const text = explainTopic(byName('Transactions'), topics, settings, {}, plan)
      .map((l) => l.text)
      .join('\n');
    expect(text).toMatch(/suggested high importance, but nothing in your material says so/);
  });
  it('warns about a quote that does not mention the topic', () => {
    const lines = explainTopic(byName('Query optimization'), topics, settings, {}, plan);
    expect(lines.some((l) => /neither it nor its paragraph/.test(l.text))).toBe(true);
  });
  it('explains a held-back topic without pretending it has evidence', () => {
    const held = byName('Data warehousing and OLAP');
    const lines = explainTopic(held, topics, settings, {}, plan);
    expect(
      lines.some((l) => l.source === 'caveat' && /No passage in your material/.test(l.text)),
    ).toBe(true);
    expect(lines.some((l) => l.quote)).toBe(false);
  });
  it('shows student edits as edits, with the original suggestion', () => {
    let state = { ...initialState(TODAY), topics };
    const id = byName('Indexes').id;
    state = reducer(state, {
      type: 'topic',
      id,
      patch: { importance: 'high', minutes: 90, weak: true },
    });
    const lines = explainTopic(
      state.topics.find((t) => t.id === id)!,
      state.topics,
      settings,
      {},
      plan,
    );
    const you = lines.filter((l) => l.source === 'you').map((l) => l.text);
    expect(you.some((t) => /set importance to high \(it was suggested as medium\)/.test(t))).toBe(
      true,
    );
    expect(you.some((t) => /changed the estimate from \d+ to 90 minutes/.test(t))).toBe(true);
    expect(you.some((t) => /weak spot \(\+12 priority\)/.test(t))).toBe(true);
  });
  it('states the scheduling decision from the real plan', () => {
    const lines = explainTopic(byName('Joins'), topics, settings, {}, plan);
    const sched = lines.find((l) => /Scheduled from/.test(l.text));
    expect(sched).toBeTruthy();
    expect(sched!.source).toBe('code');
  });
  it('reports work that does not fit', () => {
    const tight = buildPlan(topics, { ...settings, minutesPerDay: 15, examDate: '2026-10-26' }, {});
    expect(tight.unscheduled.length).toBeGreaterThan(0);
    const left = topics.find((t) => t.id === tight.unscheduled[0]!.topicId)!;
    const lines = explainTopic(left, topics, { ...settings, minutesPerDay: 15 }, {}, tight);
    expect(
      lines.some((l) => l.source === 'caveat' && /do not fit before the exam/.test(l.text)),
    ).toBe(true);
  });
  it('labels every source in plain words', () => {
    expect(Object.values(SOURCE_LABEL).every((v) => v.length > 0)).toBe(true);
  });
});

describe('explainTask', () => {
  it('ties the next step to the exam, the daily time and the ranking', () => {
    const task = nextTask(plan)!;
    const topic = byName(topics.find((t) => t.id === task.topicId)!.name);
    const lines = explainTask(task, topic, topics, settings, {}, plan);
    expect(lines[0]!.source).toBe('you');
    expect(lines[0]!.text).toMatch(/120 minutes a day/);
    expect(lines.some((l) => /ranks \d+ of \d+ planned topics/.test(l.text))).toBe(true);
  });
  it('explains a revision task as a fixed rule', () => {
    const progress = {
      'relational-model': { studiedMinutes: 40, lastStudiedOn: '2026-10-23', reviewsDone: 0 },
    };
    const p = buildPlan(topics, settings, progress);
    const rev = p.days.flatMap((d) => d.tasks).find((t) => t.kind === 'revision')!;
    expect(rev).toBeTruthy();
    const lines = explainTask(rev, byName('Relational model'), topics, settings, progress, p);
    expect(lines.some((l) => /fixed rule/.test(l.text))).toBe(true);
    expect(
      lines.some((l) => l.source === 'caveat' && /not an optimised memory model/.test(l.text)),
    ).toBe(true);
  });
});
