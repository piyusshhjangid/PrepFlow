import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { EXAM_ID, examResponse, mockApi } from '../test-utils';
import { SetupPage } from './SetupPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/setup']}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/material" element={<p>MATERIAL PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

async function fillValid(user: ReturnType<typeof userEvent.setup>, date = '2099-01-01') {
  await user.type(screen.getByLabelText('What should we call you?'), 'Asha');
  await user.type(screen.getByLabelText('What are you preparing for?'), 'DBMS Final');
  fireEvent.change(screen.getByLabelText('When is the exam?'), { target: { value: date } });
}

describe('SetupPage (create)', () => {
  it('shows field-level errors for missing answers and sends nothing', async () => {
    const user = userEvent.setup();
    const calls = mockApi({});
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Continue to material' }));
    expect(await screen.findByText('Pick your exam date.')).toBeTruthy();
    expect(calls).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('When is the exam?'), {
      target: { value: '2099-01-01' },
    });
    await user.click(screen.getByRole('button', { name: 'Continue to material' }));
    expect(await screen.findByText('Add a name or nickname.')).toBeTruthy();
    expect(screen.getByText('Name the exam you are preparing for.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('requires at least one study day', async () => {
    const user = userEvent.setup();
    mockApi({});
    renderPage();
    await fillValid(user);
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      await user.click(screen.getByLabelText(day));
    }
    await user.click(screen.getByRole('button', { name: 'Continue to material' }));
    expect(await screen.findByText('Pick at least one day you can study.')).toBeTruthy();
  });

  it('shows a live availability preview that updates with the daily hours', async () => {
    const user = userEvent.setup();
    mockApi({});
    renderPage();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    fireEvent.change(screen.getByLabelText('When is the exam?'), { target: { value: tomorrow } });
    expect((await screen.findByRole('status')).textContent).toMatch(
      /Very little time: 1 study day/,
    );
    await user.clear(screen.getByLabelText('How many hours can you study each day?'));
    await user.type(screen.getByLabelText('How many hours can you study each day?'), '2');
    expect((await screen.findByRole('status')).textContent).toMatch(/2h 00m/);
  });

  it('creates the setup, remembers the workspace id, and moves on to material', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      'POST /api/profiles': { status: 201, body: { profileId: 'p', exam: examResponse() } },
    });
    renderPage();
    await fillValid(user);
    await user.clear(screen.getByLabelText('How many hours can you study each day?'));
    await user.type(screen.getByLabelText('How many hours can you study each day?'), '2.5');
    await user.type(
      screen.getByLabelText('Which subjects or topics feel difficult?'),
      'Normalization, Deadlocks',
    );
    await user.click(screen.getByRole('button', { name: 'Continue to material' }));

    expect(await screen.findByText('MATERIAL PAGE')).toBeTruthy();
    expect(window.localStorage.getItem('prepflow.examId')).toBe(EXAM_ID);
    expect(JSON.parse(String(calls[0]?.body))).toMatchObject({
      nickname: 'Asha',
      examName: 'DBMS Final',
      examDate: '2099-01-01',
      minutesPerDay: 150,
      studyDays: [0, 1, 2, 3, 4, 5, 6],
      weakTopicHints: ['Normalization', 'Deadlocks'],
    });
  });

  it('shows a server-side date error on the date field', async () => {
    const user = userEvent.setup();
    mockApi({
      'POST /api/profiles': {
        status: 400,
        body: {
          error: {
            code: 'EXAM_DATE_IN_PAST',
            message: 'That exam date has already passed. Pick today or a later date.',
          },
        },
      },
    });
    renderPage();
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Continue to material' }));
    expect(await screen.findByText(/already passed/)).toBeTruthy();
    expect(screen.getByLabelText('When is the exam?').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('SetupPage (edit)', () => {
  it('loads the existing setup and saves changes with PATCH (scenario 10: change daily hours)', async () => {
    window.localStorage.setItem('prepflow.examId', EXAM_ID);
    const user = userEvent.setup();
    const calls = mockApi({
      [`GET /api/exams/${EXAM_ID}`]: { body: examResponse() },
      [`PATCH /api/exams/${EXAM_ID}`]: { body: examResponse({ minutesPerDay: 240 }) },
    });
    renderPage();
    expect(await screen.findByText('Edit your study setup')).toBeTruthy();
    expect((screen.getByLabelText('What are you preparing for?') as HTMLInputElement).value).toBe(
      'DBMS Final',
    );

    await user.clear(screen.getByLabelText('How many hours can you study each day?'));
    await user.type(screen.getByLabelText('How many hours can you study each day?'), '4');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('MATERIAL PAGE')).toBeTruthy();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(JSON.parse(String(patch?.body))).toMatchObject({
      minutesPerDay: 240,
      examName: 'DBMS Final',
    });
  });

  it('starts fresh, with an explanation, when the stored setup no longer exists', async () => {
    window.localStorage.setItem('prepflow.examId', EXAM_ID);
    mockApi({
      [`GET /api/exams/${EXAM_ID}`]: {
        status: 404,
        body: { error: { code: 'EXAM_NOT_FOUND', message: 'gone' } },
      },
    });
    renderPage();
    expect(await screen.findByText(/couldn’t find your previous setup/)).toBeTruthy();
    await waitFor(() => expect(window.localStorage.getItem('prepflow.examId')).toBeNull());
    expect(screen.getByText('Set up your exam')).toBeTruthy();
  });
});
