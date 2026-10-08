import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localIsoDate } from '../lib/format';
import { EXAM_ID, mockApi } from '../test-utils';
import { PlanPage } from './PlanPage';
import { TodayPage } from './TodayPage';

const DATE = localIsoDate();
const progress = (o: Record<string, unknown> = {}) => ({
  tasksTotal: 3,
  tasksCompleted: 0,
  tasksSkipped: 0,
  tasksInProgress: 0,
  tasksRemaining: 3,
  plannedMinutes: 135,
  completedMinutes: 0,
  remainingMinutes: 135,
  skippedMinutes: 0,
  overdueTasks: 0,
  overdueMinutes: 0,
  revisionTotal: 1,
  revisionCompleted: 0,
  topicsTotal: 2,
  topicsCompleted: 0,
  topicsDeferred: 0,
  completionPct: 0,
  ...o,
});
const task = (o: Record<string, unknown> = {}) => ({
  id: '55555555-5555-4555-8555-555555555551',
  topicId: 't1',
  topicName: 'CPU scheduling',
  subjectName: 'Operating Systems',
  type: 'STUDY',
  revisionIndex: null,
  partIndex: null,
  partCount: null,
  date: DATE,
  originalDate: null,
  minutes: 60,
  actualMinutes: null,
  status: 'PENDING',
  startedAt: null,
  completedAt: null,
  priorityScore: 70,
  level: 'HIGH',
  tier: 'MUST',
  reasons: ['High importance in your material (+24)', 'You marked this as a weak topic (+20)'],
  prerequisites: ['Process basics'],
  evidence: { materialName: 'os.pdf', page: 14, pageEnd: null },
  overdue: false,
  ...o,
});
const fit = (o: Record<string, unknown> = {}) => ({
  status: 'GOOD',
  headline: 'Your syllabus fits: 3h of new material plus revision in 10h of available time.',
  daysUntilExam: 10,
  studyDays: 8,
  totalMinutes: 600,
  bufferMinutes: 60,
  revisionReserveMinutes: 80,
  usableMinutes: 540,
  studyCapacityMinutes: 460,
  requiredStudyMinutes: 180,
  scheduledStudyMinutes: 180,
  deferredStudyMinutes: 0,
  revisionScheduledMinutes: 45,
  revisionDroppedMinutes: 0,
  plannedMinutes: 225,
  capacityGapMinutes: 0,
  ...o,
});
const insight = (o: Record<string, unknown> = {}) => ({
  topicId: 't1',
  name: 'CPU scheduling',
  subjectName: 'Operating Systems',
  difficulty: 'HARD',
  importance: 'HIGH',
  isWeak: true,
  score: 70,
  level: 'HIGH',
  tier: 'MUST',
  components: {
    importance: 24,
    emphasis: 0,
    weakness: 20,
    difficulty: 8,
    foundation: 4,
    urgency: 0,
    evidence: 4,
    revision: 2,
  },
  reasons: [
    { code: 'IMPORTANCE', points: 24, text: 'High importance in your material (+24)' },
    { code: 'WEAK', points: 20, text: 'You marked this as a weak topic (+20)' },
  ],
  placement: 'Core topic: scheduled first and protected if time gets short.',
  estimatedMinutes: 90,
  requiredMinutes: 90,
  scheduledMinutes: 90,
  directDependents: 1,
  prerequisites: [{ id: 't0', name: 'Process basics' }],
  evidence: { materialName: 'os.pdf', page: 14, pageEnd: null },
  ...o,
});
const plan = (o: Record<string, unknown> = {}, f = fit()) => ({
  id: '66666666-6666-4666-8666-666666666666',
  version: 1,
  trigger: 'GENERATE',
  planDate: DATE,
  createdAt: '2026-10-05T10:00:00.000Z',
  examDate: '2026-10-20',
  daysUntilExam: 15,
  summary: {
    fit: f,
    tiers: {
      MUST: { topics: 1, minutes: 90 },
      SHOULD: { topics: 0, minutes: 0 },
      IF_TIME: { topics: 0, minutes: 0 },
      DEFER: { topics: 0, minutes: 0 },
    },
    topics: [insight()],
    warnings: [],
    graph: { topics: 2, edges: 1, orphans: 0, cyclesBroken: 0 },
    revision: { scheduled: 1, dropped: 0, compressed: 0 },
    recovery: null,
  },
  progress: progress(),
  topicProgress: [],
  days: [
    {
      date: DATE,
      capacityMinutes: 160,
      plannedMinutes: 135,
      completedMinutes: 0,
      revisionMinutes: 0,
      taskCount: 3,
    },
  ],
  tasks: [task()],
  settingsChanged: false,
  ...o,
});
const getPlan = (p: unknown, extra: Record<string, unknown> = {}) => ({
  plan: p,
  today: DATE,
  staleReason: null,
  versions: p
    ? [
        {
          id: 'v',
          version: 1,
          status: 'ACTIVE',
          trigger: 'GENERATE',
          planDate: DATE,
          createdAt: '2026-10-05T10:00:00.000Z',
          archivedReason: null,
        },
      ]
    : [],
  ...extra,
});
const today = (o: Record<string, unknown> = {}) => ({
  date: DATE,
  hasPlan: true,
  examDate: '2026-10-20',
  daysUntilExam: 15,
  isStudyDay: true,
  capacityMinutes: 160,
  plannedMinutes: 60,
  completedMinutes: 0,
  remainingMinutes: 60,
  tasks: [task()],
  overdue: [],
  overdueMinutes: 0,
  urgentRevision: 0,
  progress: progress(),
  warnings: [],
  ...o,
});

const PLAN_URL = `GET /api/exams/${EXAM_ID}/plan?date=${DATE}`;
const TODAY_URL = `GET /api/exams/${EXAM_ID}/plan/today?date=${DATE}`;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/today" element={<TodayPage />} />
        <Route path="/setup" element={<p>SETUP PAGE</p>} />
        <Route path="/topics/:topicId" element={<p>TOPIC PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.setItem('prepflow.examId', EXAM_ID));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('PlanPage', () => {
  it('redirects to setup without a workspace', async () => {
    window.localStorage.clear();
    mockApi({});
    renderAt('/plan');
    expect(await screen.findByText('SETUP PAGE')).toBeTruthy();
  });

  it('offers to generate when there is no plan, then shows it', async () => {
    let generated = false;
    const calls = mockApi({
      [PLAN_URL]: () => ({ body: getPlan(generated ? plan() : null) }),
      [`POST /api/exams/${EXAM_ID}/plan`]: () => {
        generated = true;
        return { status: 201, body: { plan: plan() } };
      },
    });
    renderAt('/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Generate study plan' }));
    expect(await screen.findByText(/Plan fit:/)).toBeTruthy();
    expect(screen.getByText('GOOD')).toBeTruthy();
    expect(screen.getByText(/Exam in 15 days/)).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(JSON.parse(post.body as string)).toEqual({ planDate: DATE });
  });

  it('explains an over-capacity plan with the gap and the deferred topics', async () => {
    const over = plan(
      {},
      fit({
        status: 'OVER_CAPACITY',
        capacityGapMinutes: 990,
        requiredStudyMinutes: 2430,
        totalMinutes: 1440,
        deferredStudyMinutes: 600,
        headline:
          'The complete syllabus does not fit into your available study time. You need 40h 30m for new material but have 24h.',
      }),
    );
    over.summary.warnings = [
      {
        code: 'OVER_CAPACITY',
        message:
          'You have 16h 30m less study capacity than the remaining material needs. Deferred: Indexing.',
      },
    ] as never;
    over.summary.tiers.DEFER = { topics: 2, minutes: 600 };
    mockApi({ [PLAN_URL]: { body: getPlan(over) } });
    renderAt('/plan');
    expect(await screen.findByText('OVER CAPACITY')).toBeTruthy();
    expect(screen.getByText(/complete syllabus does not fit/i)).toBeTruthy();
    expect(screen.getByText(/16h 30m less capacity/)).toBeTruthy();
    expect(screen.getByText('Deferred')).toBeTruthy();
  });

  it('shows why a topic has its priority, from deterministic reasons', async () => {
    mockApi({ [PLAN_URL]: { body: getPlan(plan()) } });
    renderAt('/plan');
    const link = await screen.findByRole('link', { name: 'CPU scheduling' });
    const item = link.closest('li')!;
    await userEvent.click(within(item).getByText('Why this priority?'));
    expect(within(item).getByText('You marked this as a weak topic (+20)')).toBeTruthy();
    expect(within(item).getByText(/needs about 1h 30m/)).toBeTruthy();
  });

  it('offers recovery when tasks were missed and calls rebalance', async () => {
    const missed = plan({ progress: progress({ overdueTasks: 2, overdueMinutes: 90 }) });
    const calls = mockApi({
      [PLAN_URL]: { body: getPlan(missed) },
      [`POST /api/exams/${EXAM_ID}/plan/rebalance`]: { body: { plan: plan({ version: 2 }) } },
    });
    renderAt('/plan');
    await userEvent.click(await screen.findByRole('button', { name: 'Move missed tasks' }));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(JSON.parse(post.body as string)).toMatchObject({ mode: 'RECOVER', planDate: DATE });
    expect(await screen.findByText(/moved into your spare time/)).toBeTruthy();
  });

  it('tells the student when their settings changed', async () => {
    mockApi({ [PLAN_URL]: { body: getPlan(plan({ settingsChanged: true })) } });
    renderAt('/plan');
    expect(await screen.findByText(/settings changed after this plan was made/)).toBeTruthy();
  });

  it('explains a plan that was archived by re-analysis', async () => {
    mockApi({
      [PLAN_URL]: {
        body: getPlan(null, {
          staleReason:
            'Your material was analyzed again, so the old plan no longer matches the topics. Generate a new one.',
        }),
      },
    });
    renderAt('/plan');
    expect(await screen.findByText(/analyzed again/)).toBeTruthy();
  });
});

describe('TodayPage', () => {
  it('shows planned vs available time and the day’s tasks with reasons', async () => {
    mockApi({ [TODAY_URL]: { body: today() } });
    renderAt('/today');
    expect(await screen.findByText('Today’s study plan')).toBeTruthy();
    expect(screen.getByText('CPU scheduling')).toBeTruthy();
    expect(screen.getByText(/You marked this as a weak topic/)).toBeTruthy();
    expect(screen.getByText(/Builds on: Process basics/)).toBeTruthy();
    expect(screen.getByText('2h 40m')).toBeTruthy(); // available
  });

  it('completes a task and shows the server’s updated numbers without a page reload', async () => {
    let done = false;
    const calls = mockApi({
      [TODAY_URL]: () => ({
        body: done
          ? today({
              tasks: [task({ status: 'COMPLETED' })],
              completedMinutes: 60,
              remainingMinutes: 0,
            })
          : today(),
      }),
      [`POST /api/study-tasks/${task().id}/complete`]: () => {
        done = true;
        return {
          body: { task: task({ status: 'COMPLETED' }), progress: progress({ tasksCompleted: 1 }) },
        };
      },
    });
    renderAt('/today');
    await userEvent.click(await screen.findByRole('button', { name: 'Complete CPU scheduling' }));
    expect(await screen.findByText('Everything planned for today is done.')).toBeTruthy();
    expect(screen.getByText('Finished today')).toBeTruthy();
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body as string)).toEqual({
      planDate: DATE,
    });
  });

  it('undoes a completed task using the server state and returns it to the to-do list', async () => {
    let completed = true;
    const calls = mockApi({
      [TODAY_URL]: () => ({
        body: completed
          ? today({
              tasks: [task({ status: 'COMPLETED' })],
              completedMinutes: 60,
              remainingMinutes: 0,
            })
          : today(),
      }),
      [`POST /api/study-tasks/${task().id}/uncomplete`]: () => {
        completed = false;
        return {
          body: { task: task({ status: 'PENDING' }), progress: progress({ tasksCompleted: 0 }) },
        };
      },
    });
    renderAt('/today');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Undo completion of CPU scheduling' }),
    );
    expect(await screen.findByRole('button', { name: 'Complete CPU scheduling' })).toBeTruthy();
    expect(JSON.parse(calls.find((call) => call.method === 'POST')!.body as string)).toEqual({
      planDate: DATE,
    });
  });

  it('skips a task', async () => {
    let skipped = false;
    mockApi({
      [TODAY_URL]: () => ({
        body: skipped
          ? today({ tasks: [task({ status: 'SKIPPED' })], plannedMinutes: 0, remainingMinutes: 0 })
          : today(),
      }),
      [`POST /api/study-tasks/${task().id}/skip`]: () => {
        skipped = true;
        return { body: { task: task({ status: 'SKIPPED' }), progress: progress() } };
      },
    });
    renderAt('/today');
    await userEvent.click(await screen.findByRole('button', { name: 'Skip CPU scheduling' }));
    expect(await screen.findByText('Skipped')).toBeTruthy();
  });

  it('shows an error from the server and reloads the real state', async () => {
    mockApi({
      [TODAY_URL]: { body: today() },
      [`POST /api/study-tasks/${task().id}/complete`]: {
        status: 409,
        body: {
          error: {
            code: 'PLAN_CHANGED',
            message: 'This plan was updated. Reload to see the current plan.',
          },
        },
      },
    });
    renderAt('/today');
    await userEvent.click(await screen.findByRole('button', { name: 'Complete CPU scheduling' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'This plan was updated. Reload to see the current plan.',
    );
  });

  it('warns about overdue work and about urgent revision', async () => {
    mockApi({
      [TODAY_URL]: {
        body: today({
          overdue: [
            task({ id: '55555555-5555-4555-8555-555555555552', overdue: true, date: '2026-01-01' }),
          ],
          overdueMinutes: 60,
          urgentRevision: 2,
        }),
      },
    });
    renderAt('/today');
    expect(await screen.findByText(/still open/)).toBeTruthy();
    expect(screen.getByText(/2 revision sessions due now/)).toBeTruthy();
  });

  it('handles a day off and a missing plan calmly', async () => {
    mockApi({
      [TODAY_URL]: {
        body: today({
          isStudyDay: false,
          capacityMinutes: 0,
          tasks: [],
          plannedMinutes: 0,
          remainingMinutes: 0,
        }),
      },
    });
    renderAt('/today');
    expect(await screen.findByText(/day off in your schedule/)).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    mockApi({ [TODAY_URL]: { body: today({ hasPlan: false }) } });
    renderAt('/today');
    expect(await screen.findByRole('link', { name: 'Build your plan' })).toBeTruthy();
  });
});
