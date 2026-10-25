import { describe, expect, it } from 'vitest';
import { topic } from '../test/factories';
import { exportMarkdown } from './export';
import { buildPlan, type PlanSettings } from './planner';

const settings: PlanSettings = {
  today: '2026-10-22',
  examDate: '2026-10-25',
  minutesPerDay: 60,
  sessionMinutes: 45,
  revisionIntervals: [1],
};

describe('exportMarkdown', () => {
  it('includes goal, topics with source, schedule, revisions and unscheduled work', () => {
    const topics = [
      topic({
        id: 'a',
        name: 'Kinematics',
        minutes: 90,
        evidence: { quote: 'Students describe motion using velocity.', start: 0, end: 10, page: 3 },
      }),
      topic({ id: 'b', name: 'Energy', minutes: 150, importance: 'low' }),
      topic({ id: 'c', name: 'Held Topic', status: 'unverified', include: false }),
    ];
    const plan = buildPlan(topics, settings, {});
    const md = exportMarkdown({ goal: 'Physics', settings, topics, plan, progress: {} });
    expect(md).toContain('# Study plan: Physics');
    expect(md).toContain('Exam: Sun 25 Oct (2026-10-25)');
    expect(md).toContain('- [ ] **Kinematics** (~1h 30m, ');
    expect(md).toContain('Source (PDF page 3): “Students describe motion using velocity.”');
    expect(md).toMatch(/### Thu 22 Oct/);
    expect(md).toMatch(/- \[ \] Study Kinematics \(part 1 of \d\): 45m/);
    expect(md).toMatch(/- \[ \] Revise Kinematics \(review 1\)/);
    expect(md).toContain('## Does not fit');
    expect(md).toMatch(/Energy: .* of study not scheduled/);
    expect(md).toContain('## Held back');
    expect(md).toContain('- Held Topic');
  });
  it('marks finished topics and says everything fits when it does', () => {
    const topics = [topic({ id: 'a', name: 'Alpha', minutes: 30 })];
    const progress = { a: { studiedMinutes: 30, lastStudiedOn: '2026-10-22', reviewsDone: 0 } };
    const md = exportMarkdown({
      goal: '',
      settings,
      topics,
      plan: buildPlan(topics, settings, progress),
      progress,
    });
    expect(md).toContain('# Study plan\n');
    expect(md).toContain('- [x] **Alpha**');
    expect(md).toContain('_Everything fits before the exam._');
  });
  it('flattens multi-line names and long quotes so the Markdown stays well-formed', () => {
    const topics = [
      topic({
        id: 'a',
        name: 'Line one\nline two',
        evidence: { quote: `${'word '.repeat(80)}`, start: 0, end: 1, page: null },
      }),
    ];
    const md = exportMarkdown({
      goal: 'x\ny',
      settings,
      topics,
      plan: buildPlan(topics, settings, {}),
      progress: {},
    });
    expect(md).toContain('**Line one line two**');
    expect(md).toContain('# Study plan: x y');
    expect(md).toContain('…”');
  });
  it('handles an empty plan', () => {
    const md = exportMarkdown({
      goal: '',
      settings,
      topics: [],
      plan: buildPlan([], settings, {}),
      progress: {},
    });
    expect(md).toContain('_No topics selected._');
    expect(md).toContain('_Nothing scheduled._');
  });
});
