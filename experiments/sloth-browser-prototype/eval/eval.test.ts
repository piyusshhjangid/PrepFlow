import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { outlineMaterial, emptyReport } from '../src/ai/analyze';
import { buildPlan } from '../src/core/planner';
import type { Topic } from '../src/core/types';
import { topic } from '../src/test/factories';
import { FAULTS, runFault } from './faults';
import { checkPlan } from './invariants';
import { computeMetrics, matchGold, mean, scenarioSettings, type Gold } from './metrics';
import { runMutations } from './mutations';

const read = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const gold = JSON.parse(read('gold.json')) as { samples: Record<string, Gold> };
const manifest = JSON.parse(read('manifest.json')) as { samples: { id: string; file: string }[] };

describe('gold set and manifest', () => {
  it('has a gold entry and a file for every sample, with unique ids and a valid reference order', () => {
    for (const s of manifest.samples) {
      expect(read(s.file).length, s.id).toBeGreaterThan(100);
      const g = gold.samples[s.id];
      expect(g, s.id).toBeTruthy();
      const ids = g!.topics.map((t) => t.id);
      expect(new Set(ids).size, s.id).toBe(ids.length);
      expect([...g!.referenceOrder].sort(), s.id).toEqual([...ids].sort());
      for (const t of g!.topics)
        expect(() => new RegExp(t.match, 'i'), `${s.id}/${t.id}`).not.toThrow();
    }
  });
  it('covers the cases the evaluation claims to cover', () => {
    const lens = Object.fromEntries(manifest.samples.map((s) => [s.id, read(s.file).length]));
    expect(lens['07-long-multichunk']).toBeGreaterThan(12_000); // forces several chunks
    expect(gold.samples['06-many-topics']!.topics.length).toBeGreaterThanOrEqual(20);
    expect(gold.samples['05-insufficient-information']!.topics).toEqual([]);
    expect(gold.samples['08-contradictory-priorities']!.topics.some((t) => t.ambiguous)).toBe(true);
  });
});

describe('computeMetrics', () => {
  const g: Gold = {
    topics: [
      { id: 'a', match: 'alpha', high: true },
      { id: 'b', match: 'beta' },
      { id: 'c', match: 'gamma' },
    ],
    referenceOrder: ['a', 'b', 'c'],
  };
  const report = () => ({
    ...emptyReport('model', 'ollama', 'm', 100),
    chunks: 4,
    repairs: 1,
    chunkFailures: [{ chunk: 4, code: 'INVALID_OUTPUT' as const }],
    candidateTopics: 10,
    candidatesUnverified: 2,
    duplicatesMerged: 1,
    weakSupport: 1,
  });
  it('computes recall, precision, importance and rates from known inputs', () => {
    const topics: Topic[] = [
      topic({ id: 'alpha', name: 'Alpha', importance: 'high' }),
      topic({ id: 'beta', name: 'Beta' }),
      topic({ id: 'delta', name: 'Delta (not in gold)', importance: 'high' }),
      topic({ id: 'eps', name: 'Epsilon', status: 'unverified', include: false }),
    ];
    const m = computeMetrics(topics, report(), g);
    expect(m).toMatchObject({
      goldTopics: 3,
      goldFound: 2,
      verifiedTopics: 3,
      candidates: 10,
      duplicateProposalRate: 0.1,
      evidencePassRate: 0.8,
      fabricatedRate: 0.2,
      highRecall: 1,
      highPrecision: 0.5,
      firstTryValidRate: 0.5,
    });
    expect(m.recall).toBeCloseTo(2 / 3);
    expect(m.precision).toBeCloseTo(2 / 3);
    expect(m.weakSupportRate).toBeCloseTo(1 / 3);
  });
  it('never turns an undefined metric into a number', () => {
    const m = computeMetrics(
      [],
      { ...emptyReport('outline', 'o', 'none', 1) },
      { topics: [], referenceOrder: [] },
    );
    expect(m).toMatchObject({
      recall: null,
      precision: null,
      highRecall: null,
      highPrecision: null,
      orderAgreement: null,
      firstTryValidRate: null,
    });
    expect(mean([null, null])).toBeNull();
    expect(mean([1, null, 0])).toBe(0.5);
  });
  it('ignores held-back topics when matching gold, and scores order only over found topics', () => {
    const topics = [
      topic({ id: 'alpha', name: 'Alpha', order: 2 }),
      topic({ id: 'beta', name: 'Beta', order: 1 }),
      topic({ id: 'gamma', name: 'Gamma', status: 'unverified', include: false }),
    ];
    expect([...matchGold(topics, g).keys()].sort()).toEqual(['a', 'b']);
    const m = computeMetrics(topics, report(), g);
    expect(m.orderAgreement).toBeGreaterThanOrEqual(0);
    expect(m.orderAgreement).toBeLessThanOrEqual(1);
  });
  it('does not score importance on topics the material contradicts itself about', () => {
    const gg: Gold = {
      topics: [{ id: 'h', match: 'hypothesis', ambiguous: true }],
      referenceOrder: ['h'],
    };
    const m = computeMetrics(
      [topic({ id: 'h', name: 'Hypothesis testing', importance: 'high' })],
      report(),
      gg,
    );
    expect(m.highPrecision).toBeNull();
  });
});

describe('invariant checker', () => {
  const topics = [
    topic({ id: 'a', name: 'A', minutes: 60 }),
    topic({ id: 'b', name: 'B', minutes: 60, prerequisites: ['a'] }),
  ];
  const s = scenarioSettings(7, 60);
  it('accepts a real plan', () => {
    const p = buildPlan(topics, s, {});
    expect(checkPlan(topics, s, p)).toEqual({ capacity: 0, other: [] });
  });
  it('detects an over-full day, a task after the exam and a broken prerequisite order', () => {
    const p = buildPlan(topics, s, {});
    const broken = structuredClone(p);
    broken.days[0]!.usedMinutes = 999;
    broken.days[1]!.tasks.push({ ...broken.days[0]!.tasks[0]!, id: 'late', date: '2099-01-01' });
    const bd = broken.days.flatMap((d) => d.tasks);
    const aStudy = bd.find((t) => t.kind === 'study' && t.topicId === 'a')!;
    aStudy.date = '2026-01-11';
    const v = checkPlan(topics, s, broken);
    expect(v.capacity).toBe(1);
    expect(v.other.some((x) => /outside today..exam/.test(x))).toBe(true);
    expect(v.other.some((x) => /starts before/.test(x))).toBe(true);
  });
});

describe('fault injection suite', () => {
  it.each(FAULTS.map((f) => [f.id, f] as const))('%s behaves as required', async (_id, f) => {
    const r = await runFault(f);
    expect(r.pass, `${f.id}: ${r.observed}`).toBe(true);
  });
  it('has no duplicate ids and states a requirement for each', () => {
    expect(new Set(FAULTS.map((f) => f.id)).size).toBe(FAULTS.length);
    expect(FAULTS.every((f) => f.requirement.length > 5)).toBe(true);
  });
});

describe('verifier against synthetic quotes', () => {
  const results = runMutations(manifest.samples.map((s) => read(s.file)));
  it('agrees with the known verdict for every class', () => {
    for (const r of results) expect(r.correct, `${r.id}: ${r.correct}/${r.n}`).toBe(r.n);
  });
  it('uses a meaningful number of quotes per class', () => {
    for (const r of results) expect(r.n, r.id).toBeGreaterThan(100);
  });
});

describe('baseline on every sample', () => {
  it('only ever returns quotes that are in the material, and never capacity-violating plans', () => {
    for (const s of manifest.samples) {
      const text = read(s.file);
      const { topics, report } = outlineMaterial(text);
      for (const t of topics) if (t.evidence) expect(text).toContain(t.evidence.quote);
      const m = computeMetrics(topics, report, gold.samples[s.id]!);
      expect(m.scenarios.capacityViolations, s.id).toBe(0);
      expect(m.scenarios.otherViolations, s.id).toBe(0);
      expect(m.fabricatedRate ?? 0, s.id).toBe(0);
    }
  });
});
