import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAM_ID, examResponse, limits, materialSummary, mockApi } from '../test-utils';
import { AnalysisPage, POLL_INTERVAL_MS } from './AnalysisPage';

const run = (overrides: Record<string, unknown> = {}) => ({
  id: '44444444-4444-4444-8444-444444444444',
  examId: EXAM_ID,
  status: 'QUEUED',
  stage: null,
  provider: 'ollama',
  model: 'gemma4:e4b',
  materialCount: 1,
  totalChunks: 0,
  processedChunks: 0,
  failedChunks: 0,
  topicCount: 0,
  droppedTopics: 0,
  warnings: [],
  errorCode: null,
  errorMessage: null,
  startedAt: null,
  finishedAt: null,
  createdAt: '2026-10-04T10:00:00.000Z',
  latencyMs: null,
  ...overrides,
});
const emptyResult = { run: null, subjects: [], totalEstimatedMinutes: 0 };
const topic = (o: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'Normalization',
  parent: null,
  description: 'Reducing redundancy.',
  difficulty: 'HARD',
  importance: 'HIGH',
  effort: 'STANDARD',
  estimatedMinutes: 75,
  revisionWeight: 0.5,
  origin: 'EXTRACTED',
  statedEmphasis: true,
  confidence: 0.87,
  isWeak: true,
  weakHint: 'Normalization',
  prerequisites: ['Keys'],
  evidence: [
    {
      materialId: 'm',
      materialName: 'notes.pdf',
      page: 3,
      pageEnd: null,
      snippet: 'Normalization is the process of organizing tables',
    },
  ],
  ...o,
});
const result = (
  r = run({ status: 'SUCCEEDED', stage: 'COMPLETED', topicCount: 1, latencyMs: 12000 }),
) => ({
  run: r,
  totalEstimatedMinutes: 75,
  subjects: [{ id: 's1', name: 'Databases', topics: [topic()] }],
});

const base = (
  latest: unknown,
  res: unknown = emptyResult,
  materials: unknown[] = [materialSummary()],
) => ({
  [`GET /api/exams/${EXAM_ID}`]: { body: examResponse() },
  [`GET /api/exams/${EXAM_ID}/materials`]: { body: { materials, limits } },
  [`GET /api/exams/${EXAM_ID}/analysis/latest`]: { body: { run: latest } },
  [`GET /api/exams/${EXAM_ID}/analysis/result`]: { body: res },
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/analysis']}>
      <Routes>
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/setup" element={<p>SETUP PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.setItem('prepflow.examId', EXAM_ID));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AnalysisPage', () => {
  it('redirects to setup without a workspace', async () => {
    window.localStorage.clear();
    mockApi({});
    renderPage();
    expect(await screen.findByText('SETUP PAGE')).toBeTruthy();
  });

  it('starts an analysis and shows the server-reported run', async () => {
    const calls = mockApi({
      ...base(null),
      [`POST /api/exams/${EXAM_ID}/analysis`]: {
        status: 202,
        body: { run: run(), reused: false, alreadyRunning: false },
      },
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Start analysis' }));
    expect(await screen.findByText('Waiting to start…')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(true);
  });

  it('shows ONLY the real stage and real chunk counters, and updates when the server advances', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let current = run({ status: 'RUNNING', stage: 'CHUNKING' });
    mockApi({
      ...base(current),
      [`GET /api/exams/${EXAM_ID}/analysis/latest`]: () => ({ body: { run: current } }),
    });
    renderPage();
    const list = await screen.findByRole('list', { name: 'Analysis progress' });
    expect(
      within(list)
        .getByText(/Splitting it into sections/)
        .closest('li')
        ?.getAttribute('aria-current'),
    ).toBe('step');
    expect(within(list).queryByText(/section \d+ of/)).toBeNull();
    current = run({ status: 'RUNNING', stage: 'ANALYZING', totalChunks: 5, processedChunks: 2 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 50);
    });
    await waitFor(() => expect(screen.getByText(/section 3 of 5/)).toBeTruthy());
    expect(
      screen
        .getByText(/Reading sections with the AI model/)
        .closest('li')
        ?.getAttribute('aria-current'),
    ).toBe('step');
  });

  it('does not progress on its own: with no server change the displayed stage stays put', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi(base(run({ status: 'RUNNING', stage: 'VALIDATING' })));
    renderPage();
    await screen.findByRole('list', { name: 'Analysis progress' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    });
    expect(
      screen
        .getByText(/Checking every quote/)
        .closest('li')
        ?.getAttribute('aria-current'),
    ).toBe('step');
    expect(screen.queryByText(/Done/)).toBeNull();
  });

  it('when polling sees completion it loads and shows the results with evidence', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let done = false;
    const finished = run({
      status: 'SUCCEEDED',
      stage: 'COMPLETED',
      topicCount: 1,
      latencyMs: 12000,
    });
    mockApi({
      ...base(null),
      [`GET /api/exams/${EXAM_ID}/analysis/latest`]: () => ({
        body: { run: done ? finished : run({ status: 'RUNNING', stage: 'MERGING' }) },
      }),
      [`GET /api/exams/${EXAM_ID}/analysis/result`]: () => ({
        body: done ? result(finished) : emptyResult,
      }),
    });
    renderPage();
    await screen.findByRole('list', { name: 'Analysis progress' });
    done = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 50);
    });
    expect(await screen.findByText(/Analysis complete: 1 topic found/)).toBeTruthy();
    expect(screen.getByText('Normalization')).toBeTruthy();
    expect(screen.getByText(/Weak topic: matches “Normalization”/)).toBeTruthy();
    expect(screen.getByText(/Difficulty: Hard/)).toBeTruthy();
    expect(screen.getByText(/AI confidence: 87%/)).toBeTruthy();
    expect(screen.getByText(/~1h 15m/)).toBeTruthy();
    expect(screen.getByText(/Needs first: Keys/)).toBeTruthy();
    expect(screen.getByText(/notes.pdf · PDF page 3/)).toBeTruthy();
    expect(screen.getByText(/Normalization is the process of organizing tables/)).toBeTruthy();
  });

  it('saves reviewed importance, minutes and weak status through the API', async () => {
    const calls = mockApi({
      ...base(run({ status: 'SUCCEEDED', stage: 'COMPLETED', topicCount: 1 }), result()),
      [`PATCH /api/exams/${EXAM_ID}/topics/t1`]: {
        body: result(run({ status: 'SUCCEEDED', stage: 'COMPLETED', topicCount: 1 })),
      },
    });
    renderPage();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Importance / priority'), 'LOW');
    const minutes = screen.getByLabelText('Study minutes');
    await user.clear(minutes);
    await user.type(minutes, '60');
    await user.click(screen.getByLabelText('Weak topic'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByText('Topic saved. Rebalance your plan to apply the changes.');
    const saved = calls.find((call) => call.method === 'PATCH');
    expect(JSON.parse(String(saved?.body))).toMatchObject({
      importance: 'LOW',
      estimatedMinutes: 60,
      isWeak: false,
    });
  });

  it('shows the safe server error for a failed run, with no fake success', async () => {
    mockApi(
      base(
        run({
          status: 'FAILED',
          errorCode: 'AI_UNAVAILABLE',
          errorMessage:
            'The AI model could not be reached or kept failing. Please try again in a few minutes.',
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText(/Analysis failed\./)).toBeTruthy();
    expect(screen.getByText(/could not be reached/)).toBeTruthy();
    expect(screen.queryByText(/Analysis complete/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Analyze again' })).toBeTruthy();
  });

  it('explains partial results and dropped topics', async () => {
    const partial = run({
      status: 'PARTIAL',
      stage: 'COMPLETED',
      topicCount: 1,
      failedChunks: 2,
      droppedTopics: 3,
      warnings: ['CHUNK_FAILED', 'TOPICS_DROPPED'],
    });
    mockApi(base(partial, result(partial)));
    renderPage();
    expect(await screen.findByText(/2 sections could not be analyzed/)).toBeTruthy();
    expect(screen.getByText(/Some topics suggested by the AI were discarded.*\(3\)/)).toBeTruthy();
  });

  it('tells the user when nothing changed and the existing analysis is reused', async () => {
    const done = run({ status: 'SUCCEEDED', stage: 'COMPLETED', topicCount: 1 });
    mockApi({
      ...base(done, result(done)),
      [`POST /api/exams/${EXAM_ID}/analysis`]: {
        body: { run: done, reused: true, alreadyRunning: false },
      },
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Analyze again' }));
    expect(
      await screen.findByText(/haven’t changed, so the existing analysis is still current/),
    ).toBeTruthy();
  });

  it('surfaces API errors when starting (e.g. rate limit) and requires material', async () => {
    mockApi({
      ...base(null),
      [`POST /api/exams/${EXAM_ID}/analysis`]: {
        status: 429,
        body: {
          error: {
            code: 'RATE_LIMITED',
            message: 'You’re doing that a lot. Please wait a few minutes and try again.',
          },
        },
      },
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Start analysis' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('doing that a lot'),
    );
    cleanup();
    mockApi(base(null, emptyResult, []));
    renderPage();
    expect(await screen.findByText(/Add some study material first/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Start analysis' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
