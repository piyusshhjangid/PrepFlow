import { vi } from 'vitest';

/** One scripted HTTP response for the mocked fetch. */
export interface MockResponse {
  status?: number;
  body?: unknown;
}

export interface RecordedCall {
  url: string;
  method: string;
  body: BodyInit | null | undefined;
}

/**
 * Replaces global fetch with a router: `routes` maps "METHOD /path" to a response (or a function
 * returning one). Unmatched requests fail the test loudly. Returns the recorded calls.
 */
export function mockApi(
  routes: Record<string, MockResponse | ((call: RecordedCall) => MockResponse)>,
): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: RecordedCall = { url, method: init?.method ?? 'GET', body: init?.body };
      calls.push(call);
      const handler = routes[`${call.method} ${url}`];
      if (!handler) throw new Error(`Unexpected request: ${call.method} ${url}`);
      const { status = 200, body } = typeof handler === 'function' ? handler(call) : handler;
      return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

export const EXAM_ID = '11111111-1111-4111-8111-111111111111';

export const examResponse = (overrides: Record<string, unknown> = {}) => ({
  id: EXAM_ID,
  profileId: '22222222-2222-4222-8222-222222222222',
  nickname: 'Asha',
  name: 'DBMS Final',
  examDate: '2026-10-11',
  minutesPerDay: 180,
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  weakTopicHints: ['Normalization'],
  confidence: null,
  revisionIntervalsDays: [1, 3, 7],
  revisionReservePct: 15,
  blockedDates: [],
  bufferPct: 10,
  availability: { daysUntilExam: 8, studyDays: 8, availableMinutes: 1440 },
  ...overrides,
});

export const limits = {
  maxChars: 200000,
  maxPdfBytes: 10 * 1024 * 1024,
  maxPdfPages: 100,
  maxMaterialsPerExam: 10,
};

export const materialSummary = (overrides: Record<string, unknown> = {}) => ({
  id: '33333333-3333-4333-8333-333333333333',
  examId: EXAM_ID,
  sourceType: 'TEXT',
  filename: null,
  charCount: 1234,
  pageCount: null,
  lowTextPageCount: null,
  createdAt: '2026-10-03T10:00:00.000Z',
  ...overrides,
});
