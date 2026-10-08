import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXAM_ID, examResponse, limits, materialSummary, mockApi } from '../test-utils';
import { MaterialPage } from './MaterialPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/material']}>
      <Routes>
        <Route path="/material" element={<MaterialPage />} />
        <Route path="/setup" element={<p>SETUP PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const baseRoutes = (materials: unknown[] = []) => ({
  [`GET /api/exams/${EXAM_ID}`]: { body: examResponse() },
  [`GET /api/exams/${EXAM_ID}/materials`]: { body: { materials, limits } },
});

const NOTES = 'Normalization (1NF, 2NF, 3NF, BCNF) and deadlocks. '.repeat(3);

beforeEach(() => window.localStorage.setItem('prepflow.examId', EXAM_ID));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('MaterialPage', () => {
  it('redirects to setup when there is no workspace in this browser', async () => {
    window.localStorage.clear();
    mockApi({});
    renderPage();
    expect(await screen.findByText('SETUP PAGE')).toBeTruthy();
  });

  it('redirects to setup when the stored exam no longer exists', async () => {
    mockApi({
      [`GET /api/exams/${EXAM_ID}`]: {
        status: 404,
        body: { error: { code: 'EXAM_NOT_FOUND', message: 'gone' } },
      },
      [`GET /api/exams/${EXAM_ID}/materials`]: {
        status: 404,
        body: { error: { code: 'EXAM_NOT_FOUND', message: 'gone' } },
      },
    });
    renderPage();
    expect(await screen.findByText('SETUP PAGE')).toBeTruthy();
    expect(window.localStorage.getItem('prepflow.examId')).toBeNull();
  });

  it('shows the intentional empty state, exam summary, and the server-provided limits', async () => {
    mockApi(baseRoutes());
    renderPage();
    expect(
      await screen.findByText('Upload your syllabus or notes to start building your plan.'),
    ).toBeTruthy();
    expect(screen.getByText(/DBMS Final/)).toBeTruthy();
    expect(screen.getByText(/24h 00m of study time/)).toBeTruthy();
    expect(screen.getByText(/Up to 10.0 MB and 100 pages/)).toBeTruthy();
    expect(screen.getByText(/0 \/ 200,000 characters/)).toBeTruthy();
  });

  it('shows a retryable error when the server is unreachable', async () => {
    mockApi({
      [`GET /api/exams/${EXAM_ID}`]: () => {
        throw new TypeError('network down');
      },
      [`GET /api/exams/${EXAM_ID}/materials`]: { body: { materials: [], limits } },
    });
    renderPage();
    expect(await screen.findByText('We couldn’t load your material')).toBeTruthy();
    expect(screen.getByText(/can’t reach the server/)).toBeTruthy();
  });

  it('adds pasted text, clears the box, and lists the new material', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...baseRoutes(),
      [`POST /api/exams/${EXAM_ID}/materials/text`]: {
        status: 201,
        body: { material: materialSummary({ charCount: NOTES.length }), duplicate: false },
      },
    });
    renderPage();
    await user.type(await screen.findByLabelText('Syllabus or notes'), 'x');
    await user.clear(screen.getByLabelText('Syllabus or notes'));
    await user.click(screen.getByLabelText('Syllabus or notes'));
    await user.paste(NOTES);
    await user.click(screen.getByRole('button', { name: 'Add pasted text' }));

    expect(await screen.findByText('Added to your material.')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST');
    expect(JSON.parse(String(post?.body))).toEqual({ text: NOTES });
    expect((screen.getByLabelText('Syllabus or notes') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('Pasted text', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('Your material (1 of 10)')).toBeTruthy();
  });

  it('tells the user a duplicate was recognized and changes nothing', async () => {
    const user = userEvent.setup();
    mockApi({
      ...baseRoutes([materialSummary()]),
      [`POST /api/exams/${EXAM_ID}/materials/text`]: {
        status: 200,
        body: { material: materialSummary(), duplicate: true },
      },
    });
    renderPage();
    await user.click(await screen.findByLabelText('Syllabus or notes'));
    await user.paste(NOTES);
    await user.click(screen.getByRole('button', { name: 'Add pasted text' }));
    expect(await screen.findByText('You’ve already added this. Nothing was changed.')).toBeTruthy();
    expect(screen.getByText('Your material (1 of 10)')).toBeTruthy();
  });

  it('shows the server’s error and KEEPS the pasted text so nothing is lost', async () => {
    const user = userEvent.setup();
    mockApi({
      ...baseRoutes(),
      [`POST /api/exams/${EXAM_ID}/materials/text`]: {
        status: 422,
        body: {
          error: {
            code: 'TEXT_TOO_SHORT',
            message:
              'There isn’t enough text to build a study plan from. Add more of your syllabus or notes.',
          },
        },
      },
    });
    renderPage();
    await user.click(await screen.findByLabelText('Syllabus or notes'));
    await user.paste(NOTES);
    await user.click(screen.getByRole('button', { name: 'Add pasted text' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Add more of your syllabus or notes/,
    );
    expect((screen.getByLabelText('Syllabus or notes') as HTMLTextAreaElement).value).toBe(NOTES);
  });

  it('refuses to send empty text', async () => {
    const user = userEvent.setup();
    const calls = mockApi(baseRoutes());
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add pasted text' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Paste some of your syllabus/);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('uploads a PDF as multipart "file" and shows the page count', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...baseRoutes(),
      [`POST /api/exams/${EXAM_ID}/materials/pdf`]: {
        status: 201,
        body: {
          material: materialSummary({
            sourceType: 'PDF',
            filename: 'notes.pdf',
            pageCount: 14,
            lowTextPageCount: 0,
            charCount: 9000,
          }),
          duplicate: false,
        },
      },
    });
    renderPage();
    const input = await screen.findByLabelText('Choose a PDF');
    await user.upload(input, new File(['%PDF-1.4 fake'], 'notes.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Upload PDF' }));

    expect(await screen.findByText('Added to your material.')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toBeInstanceOf(FormData);
    expect((post?.body as FormData).get('file')).toBeInstanceOf(File);
    expect(screen.getByText(/PDF · 14 PDF pages · 9,000 characters/)).toBeTruthy();
  });

  it('warns honestly when some PDF pages had little or no text', async () => {
    const user = userEvent.setup();
    mockApi({
      ...baseRoutes(),
      [`POST /api/exams/${EXAM_ID}/materials/pdf`]: {
        status: 201,
        body: {
          material: materialSummary({
            sourceType: 'PDF',
            filename: 'n.pdf',
            pageCount: 10,
            lowTextPageCount: 3,
          }),
          duplicate: false,
        },
      },
    });
    renderPage();
    await user.upload(
      await screen.findByLabelText('Choose a PDF'),
      new File(['%PDF'], 'n.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: 'Upload PDF' }));
    expect((await screen.findByRole('status')).textContent).toMatch(
      /3 PDF pages of 10 had little or no selectable text/,
    );
  });

  it('rejects a non-PDF file in the browser without calling the server', async () => {
    const calls = mockApi(baseRoutes());
    renderPage();
    const input = await screen.findByLabelText('Choose a PDF');
    // applyAccept:false so the browser-style accept filter doesn't hide the wrong file from the handler
    await userEvent
      .setup({ applyAccept: false })
      .upload(input, new File(['hello'], 'notes.docx', { type: 'application/msword' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Only PDF files can be uploaded/,
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect((screen.getByRole('button', { name: 'Upload PDF' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows a PDF_NO_TEXT error with the actionable message from the server', async () => {
    const user = userEvent.setup();
    mockApi({
      ...baseRoutes(),
      [`POST /api/exams/${EXAM_ID}/materials/pdf`]: {
        status: 422,
        body: {
          error: {
            code: 'PDF_NO_TEXT',
            message:
              'We couldn’t analyze this document. Check that the PDF contains selectable text and try again. You can also paste the text instead.',
          },
        },
      },
    });
    renderPage();
    await user.upload(
      await screen.findByLabelText('Choose a PDF'),
      new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: 'Upload PDF' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Check that the PDF contains selectable text/,
    );
  });

  it('removes a material only after confirmation', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...baseRoutes([materialSummary()]),
      [`DELETE /api/materials/${materialSummary().id}`]: { status: 204 },
    });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Remove/ }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false); // first click only asks
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() =>
      expect(
        screen.getByText('Upload your syllabus or notes to start building your plan.'),
      ).toBeTruthy(),
    );
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('keeps the analyze button disabled and explains why, rather than faking it', async () => {
    mockApi(baseRoutes());
    renderPage();
    const button = await screen.findByRole('button', { name: 'Analyze my material' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const note = within(button.parentElement as HTMLElement).getByText(
      /Analysis arrives in the next step/,
    );
    expect(button.getAttribute('aria-describedby')).toBe(note.id);
  });
});
