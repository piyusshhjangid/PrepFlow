import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAMPLE_MATERIAL, SAMPLE_PROPOSALS, loadSample } from './sample';
import { buildPlan } from '../core/planner';
import { exportMarkdown } from '../core/export';
import { validateMaterial } from '../ai/chunk';

describe('sample data', () => {
  it('uses the same syllabus as evaluation sample 01 (one source of truth)', () => {
    const file = readFileSync(
      new URL('../../eval/samples/01-structured-syllabus.txt', import.meta.url),
      'utf8',
    );
    expect(SAMPLE_MATERIAL.trim()).toBe(file.trim());
  });
  it('is valid material', () => {
    expect(validateMaterial(SAMPLE_MATERIAL)).toBeNull();
  });
  it('is never labelled as model output', () => {
    const { topics, report } = loadSample('2026-10-24');
    expect(report).toMatchObject({ mode: 'sample', provider: 'sample-fixture' });
    expect(report.model).toMatch(/none/);
    expect(topics.every((t) => t.origin === 'sample')).toBe(true);
  });
  it('runs through the real verification: the flawed proposals are caught', () => {
    const { topics, report } = loadSample('2026-10-24');
    expect(report.candidateTopics).toBe(SAMPLE_PROPOSALS.length);
    const held = topics.filter((t) => t.status === 'unverified');
    expect(held.map((t) => t.name)).toEqual(['Data warehousing and OLAP']);
    expect(held[0]).toMatchObject({ include: false, unverifiedReason: 'not-found' });
    expect(topics.find((t) => t.name === 'Query optimization')!.support).toBe('weak');
    expect(topics.find((t) => t.name === 'Transactions')).toMatchObject({
      suggestedImportance: 'high',
      importance: 'medium',
    });
    expect(topics.find((t) => t.name === 'Aggregation')).toMatchObject({
      importance: 'high',
      importanceBasis: 'material',
    });
  });
  it('every quote it shows is copied from the syllabus', () => {
    for (const t of loadSample('2026-10-24').topics) {
      if (t.evidence) expect(SAMPLE_MATERIAL).toContain(t.evidence.quote);
    }
  });
  it('produces a feasible plan for the sample settings and an export that says it is sample data', () => {
    const b = loadSample('2026-10-24');
    const s = {
      today: '2026-10-24',
      examDate: b.settings.examDate!,
      minutesPerDay: b.settings.minutesPerDay!,
      sessionMinutes: b.settings.sessionMinutes!,
      revisionIntervals: [1, 3],
    };
    const plan = buildPlan(b.topics, s, {});
    expect(plan.fit === 'fits' || plan.fit === 'tight').toBe(true);
    const md = exportMarkdown({
      goal: b.settings.goal!,
      settings: s,
      topics: b.topics,
      plan,
      progress: {},
      report: b.report,
    });
    expect(md).toMatch(/SAMPLE DATA/);
    expect(md).not.toMatch(/suggested by a local Gemma model/);
  });
});
