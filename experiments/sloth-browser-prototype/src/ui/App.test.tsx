// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError } from '../ai/errors';
import { ScriptedProvider } from '../ai/fake';
import { makePdf } from '../test/pdf-fixture';
import type { PdfLib } from '../core/pdf';
import { App } from './App';
import type { RuntimeFactory } from './runtime';

afterEach(cleanup);

const TODAY = '2026-10-22';
const MATERIAL = [
  'Unit 1 Kinematics. Students describe motion using displacement, velocity and acceleration.',
  'Unit 2 Newton Laws. Force equals mass times acceleration, and every action has an equal reaction.',
  'Unit 3 Energy. Work is force applied over a distance; energy is conserved in closed systems.',
].join('\n\n');

const topic = (name: string, evidence: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: `About ${name}.`,
  evidence,
  effort: 'medium',
  difficulty: 2,
  importance: 'medium',
  prerequisites: [],
  ...extra,
});
const GOOD = JSON.stringify({
  topics: [
    topic('Kinematics', 'Students describe motion using displacement, velocity and acceleration.'),
    topic(
      'Newton Laws',
      'Force equals mass times acceleration, and every action has an equal reaction.',
      { importance: 'high', prerequisites: ['Kinematics'] },
    ),
    topic(
      'Energy',
      'Work is force applied over a distance; energy is conserved in closed systems.',
    ),
    topic(
      'Quantum Tunnelling',
      'Particles pass through barriers because of wave behaviour in physics.',
    ),
  ],
});

const factory =
  (
    reply: string | (() => string),
    check = { reachable: true, installed: true, models: ['gemma4:e4b'] },
  ): RuntimeFactory =>
  () => ({
    provider: new ScriptedProvider(() => (typeof reply === 'function' ? reply() : reply)),
    check: async () => check,
  });

const memoryStorage = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
};

async function pasteAndAnalyze(user: ReturnType<typeof userEvent.setup>, text = MATERIAL) {
  fireEvent.change(screen.getByLabelText(/Paste your syllabus/), { target: { value: text } });
  await user.click(screen.getByRole('button', { name: 'Find my topics' }));
}

describe('first run', () => {
  it('explains what the app does and where the material goes', () => {
    render(<App today={TODAY} storage={memoryStorage()} runtimeFactory={factory(GOOD)} />);
    expect(screen.getByRole('heading', { name: 'PrepFlow Sloth' })).toBeTruthy();
    expect(screen.getByText(/never sent to a hosted AI service/)).toBeTruthy();
    expect(screen.getByLabelText('Exam date')).toBeTruthy();
    expect(screen.getByLabelText(/Study time per day/)).toBeTruthy();
  });
  it('shows a labelled, associated error for empty material and keeps focus-able controls', async () => {
    const user = userEvent.setup();
    render(<App today={TODAY} storage={memoryStorage()} runtimeFactory={factory(GOOD)} />);
    await user.click(screen.getByRole('button', { name: 'Find my topics' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Add some study material/);
    const box = screen.getByLabelText(/Paste your syllabus/);
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toContain(alert.id);
  });
  it('shows an inline error for an impossible exam setup', async () => {
    const user = userEvent.setup();
    render(<App today={TODAY} storage={memoryStorage()} runtimeFactory={factory(GOOD)} />);
    fireEvent.change(screen.getByLabelText(/Study time per day/), { target: { value: '5' } });
    expect(
      screen.getAllByRole('alert').some((a) => /between 15 and 720/.test(a.textContent ?? '')),
    ).toBe(true);
    await pasteAndAnalyze(user);
    expect(
      (await screen.findAllByRole('alert')).some((a) =>
        /between 15 and 720/.test(a.textContent ?? ''),
      ),
    ).toBe(true);
    expect(screen.queryByText('Your next step')).toBeNull();
  });
});

describe('journey: material to next step to progress', () => {
  it('analyzes, shows evidence-backed topics, holds back the unsupported one, and plans', async () => {
    const user = userEvent.setup();
    render(<App today={TODAY} storage={memoryStorage()} runtimeFactory={factory(GOOD)} />);
    await pasteAndAnalyze(user);
    const next = await screen.findByRole('region', { name: 'Your next step' });
    expect(within(next).getByText(/Today · /)).toBeTruthy();
    expect(within(next).getByText(/Why now:/)).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Your next step');
    // The invented topic is held back, labelled in text (not colour alone), and not planned.
    expect(screen.getByText(/Held back: no matching passage/)).toBeTruthy();
    expect(screen.getAllByText(/Not found in your material/).length).toBe(1);
    expect(screen.getAllByText(/Found in your material/).length).toBe(3);
    // Source passage is copied from the material.
    expect(
      screen.getAllByText('Students describe motion using displacement, velocity and acceleration.')
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/planned study minutes done/)).toBeTruthy();
  });
  it('starts with the prerequisite, and completing a task updates progress and can be undone', async () => {
    const user = userEvent.setup();
    render(<App today={TODAY} storage={memoryStorage()} runtimeFactory={factory(GOOD)} />);
    await pasteAndAnalyze(user);
    const next = await screen.findByRole('region', { name: 'Your next step' });
    expect(within(next).getByText(/Study: Kinematics|Study: Energy/)).toBeTruthy();
    expect(within(next).getByText(/Study: Kinematics/)).toBeTruthy(); // prerequisite of the high-importance topic
    const before = screen.getByText(/planned study minutes done/).textContent;
    await user.click(within(next).getByRole('button', { name: /Mark done/ }));
    expect(screen.getByText(/planned study minutes done/).textContent).not.toBe(before);
    await user.click(screen.getByRole('button', { name: 'Undo last' }));
    expect(screen.getByText(/planned study minutes done/).textContent).toBe(before);
  });
  it('keeps completed work after a reload (state is restored from storage)', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    const first = render(<App today={TODAY} storage={storage} runtimeFactory={factory(GOOD)} />);
    await pasteAndAnalyze(user);
    const next = await screen.findByRole('region', { name: 'Your next step' });
    await user.click(within(next).getByRole('button', { name: /Mark done/ }));
    const done = screen.getByText(/planned study minutes done/).textContent;
    first.unmount();
    render(<App today={TODAY} storage={storage} runtimeFactory={factory(GOOD)} />);
    expect(screen.getByText(/planned study minutes done/).textContent).toBe(done);
    expect(screen.queryByRole('button', { name: 'Find my topics' })).toBeNull();
  });
  it('marks known topics from the optional list', async () => {
    const user = userEvent.setup();
    render(<App today={TODAY} storage={memoryStorage()} runtimeFactory={factory(GOOD)} />);
    fireEvent.change(screen.getByLabelText(/Topics you already understand/), {
      target: { value: 'Energy' },
    });
    await pasteAndAnalyze(user);
    await screen.findByRole('region', { name: 'Your next step' });
    const energy = screen.getByRole('heading', { name: 'Energy' }).closest('article')!;
    expect((within(energy).getByLabelText('Already know it') as HTMLInputElement).checked).toBe(
      true,
    );
  });
});

describe('capacity honesty', () => {
  it('shows what does not fit and lets the student apply the suggested daily time', async () => {
    const user = userEvent.setup();
    render(<App today={TODAY} storage={memoryStorage()} runtimeFactory={factory(GOOD)} />);
    fireEvent.change(screen.getByLabelText('Exam date'), { target: { value: '2026-10-24' } });
    fireEvent.change(screen.getByLabelText(/Study time per day/), { target: { value: '60' } });
    await pasteAndAnalyze(user);
    const banner = await screen.findByRole('region', { name: /Not everything fits/ });
    expect(
      within(banner).getByText(/never promises more than your time allows|never promises/),
    ).toBeTruthy();
    expect(within(banner).getAllByText(/not scheduled/).length).toBeGreaterThan(0);
    await user.click(within(banner).getByRole('button', { name: /instead/ }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /Not everything fits/ })).toBeNull(),
    );
  });
  it('says so plainly when the exam is today', async () => {
    const user = userEvent.setup();
    render(<App today={TODAY} storage={memoryStorage()} runtimeFactory={factory(GOOD)} />);
    fireEvent.change(screen.getByLabelText('Exam date'), { target: { value: TODAY } });
    await pasteAndAnalyze(user);
    expect(await screen.findByText(/no study days before the exam/i)).toBeTruthy();
  });
});

describe('failure handling keeps the material', () => {
  it('reports an unreachable runtime without losing the text', async () => {
    const user = userEvent.setup();
    render(
      <App
        today={TODAY}
        storage={memoryStorage()}
        runtimeFactory={factory(GOOD, { reachable: false, installed: false, models: [] })}
      />,
    );
    await pasteAndAnalyze(user);
    expect(
      (await screen.findAllByRole('alert')).some((a) =>
        /Could not reach the local model runtime/.test(a.textContent ?? ''),
      ),
    ).toBe(true);
    expect((screen.getByLabelText(/Paste your syllabus/) as HTMLTextAreaElement).value).toBe(
      MATERIAL,
    );
  });
  it('tells the student the exact pull command for a missing model', async () => {
    const user = userEvent.setup();
    render(
      <App
        today={TODAY}
        storage={memoryStorage()}
        runtimeFactory={factory(GOOD, { reachable: true, installed: false, models: [] })}
      />,
    );
    await pasteAndAnalyze(user);
    expect(
      (await screen.findAllByRole('alert')).some((a) =>
        /ollama pull gemma4:e4b/.test(a.textContent ?? ''),
      ),
    ).toBe(true);
  });
  it('survives a model that returns garbage', async () => {
    const user = userEvent.setup();
    render(
      <App
        today={TODAY}
        storage={memoryStorage()}
        runtimeFactory={factory('I am sorry, I cannot help')}
      />,
    );
    await pasteAndAnalyze(user);
    expect(
      (await screen.findAllByRole('alert')).some((a) =>
        /did not return usable topics/.test(a.textContent ?? ''),
      ),
    ).toBe(true);
    expect((screen.getByLabelText(/Paste your syllabus/) as HTMLTextAreaElement).value).toBe(
      MATERIAL,
    );
  });
  it('survives a provider that throws mid-analysis', async () => {
    const user = userEvent.setup();
    const f: RuntimeFactory = () => ({
      provider: new ScriptedProvider(() => {
        throw new AiError('MODEL_NOT_FOUND');
      }),
      check: async () => ({ reachable: true, installed: true, models: [] }),
    });
    render(<App today={TODAY} storage={memoryStorage()} runtimeFactory={f} />);
    await pasteAndAnalyze(user);
    expect(
      (await screen.findAllByRole('alert')).some((a) => /not installed/.test(a.textContent ?? '')),
    ).toBe(true);
  });
  it('reports when no topic can be tied to the material', async () => {
    const user = userEvent.setup();
    const invented = JSON.stringify({
      topics: [topic('Invented', 'This sentence does not appear anywhere in the notes.')],
    });
    render(<App today={TODAY} storage={memoryStorage()} runtimeFactory={factory(invented)} />);
    await pasteAndAnalyze(user);
    expect(await screen.findByText(/No topic could be tied to a passage/)).toBeTruthy();
  });
});

describe('PDF upload', () => {
  const lib = async () => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfLib;
  it('extracts a text PDF into the editable material box', async () => {
    const user = userEvent.setup();
    render(
      <App
        today={TODAY}
        storage={memoryStorage()}
        runtimeFactory={factory(GOOD)}
        pdfLoader={lib}
      />,
    );
    const file = new File(
      [
        makePdf([
          'Unit 1 Kinematics describes motion using displacement and velocity in detail.',
          'Unit 2 Dynamics relates force, mass and acceleration in closed systems today.',
        ]),
      ],
      'syllabus.pdf',
      { type: 'application/pdf' },
    );
    await user.upload(screen.getByLabelText(/upload a text-based PDF/), file);
    await waitFor(() =>
      expect((screen.getByLabelText(/Paste your syllabus/) as HTMLTextAreaElement).value).toContain(
        'Kinematics describes motion',
      ),
    );
    expect(screen.getByText(/from syllabus.pdf \(2 pages\)/)).toBeTruthy();
  });
  it('explains a file that is not a PDF', async () => {
    const user = userEvent.setup();
    render(
      <App
        today={TODAY}
        storage={memoryStorage()}
        runtimeFactory={factory(GOOD)}
        pdfLoader={lib}
      />,
    );
    const input = screen.getByLabelText(/upload a text-based PDF/);
    fireEvent.change(input, {
      target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] },
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/not a PDF/);
    void user;
  });
  it('explains a broken PDF', async () => {
    render(
      <App
        today={TODAY}
        storage={memoryStorage()}
        runtimeFactory={factory(GOOD)}
        pdfLoader={lib}
      />,
    );
    fireEvent.change(screen.getByLabelText(/upload a text-based PDF/), {
      target: {
        files: [new File(['%PDF-1.4 broken broken'], 'x.pdf', { type: 'application/pdf' })],
      },
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be read/);
  });
});

describe('export and reset', () => {
  it('copies Markdown and reports success or a blocked clipboard', async () => {
    const user = userEvent.setup();
    render(<App today={TODAY} storage={memoryStorage()} runtimeFactory={factory(GOOD)} />);
    await pasteAndAnalyze(user);
    await screen.findByRole('region', { name: 'Your next step' });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copy Markdown' }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain('## Schedule');
    expect(await screen.findByText('Copied to the clipboard.')).toBeTruthy();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('blocked');
        },
      },
      configurable: true,
    });
    await user.click(screen.getByRole('button', { name: 'Copy Markdown' }));
    expect(await screen.findByText(/Copy was blocked/)).toBeTruthy();
  });
  it('start over asks first, then clears everything', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    render(<App today={TODAY} storage={storage} runtimeFactory={factory(GOOD)} />);
    await pasteAndAnalyze(user);
    await screen.findByRole('region', { name: 'Your next step' });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByRole('region', { name: 'Your next step' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: 'Find my topics' })).toBeTruthy();
  });
  it('warns when the browser will not store anything', async () => {
    const blocked = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('quota');
      },
    } as Storage;
    render(<App today={TODAY} storage={blocked} runtimeFactory={factory(GOOD)} />);
    expect(await screen.findByText(/would not save your work/)).toBeTruthy();
  });
});

describe('sample data, outline mode and explanations', () => {
  it('loads the labelled sample without any model and shows what the checks caught', async () => {
    const user = userEvent.setup();
    const down: RuntimeFactory = () => ({
      provider: new ScriptedProvider(() => {
        throw new AiError('UNREACHABLE');
      }),
      check: async () => ({ reachable: false, installed: false, models: [] }),
    });
    render(<App runtimeFactory={down} today={TODAY} storage={memoryStorage()} />);
    await user.click(screen.getByRole('button', { name: /Try the sample/ }));
    const note = screen.getByRole('note', { name: 'Sample data notice' });
    expect(within(note).getByText(/not produced by Gemma/)).toBeTruthy();
    expect(screen.getByText(/Source: hand-written sample \(not a model\)/)).toBeTruthy();
    expect(screen.getByText(/Held back: no matching passage/)).toBeTruthy();
    expect(screen.getByText(/Check this one\./)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Progress' })).toBeTruthy();
  });
  it('clearing the sample returns to an empty first screen', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    render(<App runtimeFactory={factory(GOOD)} today={TODAY} storage={storage} />);
    await user.click(screen.getByRole('button', { name: /Try the sample/ }));
    await user.click(screen.getByRole('button', { name: /Clear the sample/ }));
    expect(screen.getByLabelText(/Paste your syllabus/)).toBeTruthy();
    expect((screen.getByLabelText(/Paste your syllabus/) as HTMLTextAreaElement).value).toBe('');
    const saved = JSON.parse(storage.getItem('prepflow-sloth:v1') ?? '{}');
    expect(saved.topics).toEqual([]);
    expect(saved.material.text).toBe('');
    expect(saved.report).toBeNull();
  });
  it('outline mode builds a plan with no model and says it is not AI', async () => {
    const user = userEvent.setup();
    render(<App runtimeFactory={factory('garbage')} today={TODAY} storage={memoryStorage()} />);
    fireEvent.change(screen.getByLabelText(/Paste your syllabus/), {
      target: {
        value:
          'Week 1 - Kinematics. Students describe motion using displacement, velocity and acceleration.\nWeek 2 - Energy. Work is force applied over a distance; energy is conserved in closed systems.',
      },
    });
    await user.click(screen.getByRole('button', { name: 'Outline mode (no AI)' }));
    expect(screen.getByRole('note', { name: 'Outline mode notice' })).toBeTruthy();
    expect(screen.getByText(/Source: outline rules \(not a model\)/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your next step' })).toBeTruthy();
  });
  it('outline mode changes nothing and explains when there is no structure', async () => {
    const user = userEvent.setup();
    render(<App runtimeFactory={factory(GOOD)} today={TODAY} storage={memoryStorage()} />);
    fireEvent.change(screen.getByLabelText(/Paste your syllabus/), {
      target: {
        value:
          'Just one long unstructured sentence about physics and nothing else at all here, really.',
      },
    });
    await user.click(screen.getByRole('button', { name: 'Outline mode (no AI)' }));
    expect(await screen.findByText(/Outline mode found no headings/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Your next step' })).toBeNull();
  });
  it('an unreachable runtime offers outline mode as the way forward and keeps the text', async () => {
    const user = userEvent.setup();
    const down = factory(GOOD, { reachable: false, installed: false, models: [] });
    render(<App runtimeFactory={down} today={TODAY} storage={memoryStorage()} />);
    await pasteAndAnalyze(user);
    expect(await screen.findByText(/use outline mode \(no AI\) now/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Outline mode (no AI)' })).toBeTruthy();
  });
  it('shows the reasoning behind a topic with each statement labelled by its source', async () => {
    const user = userEvent.setup();
    render(<App runtimeFactory={factory(GOOD)} today={TODAY} storage={memoryStorage()} />);
    await pasteAndAnalyze(user);
    const topics = await screen.findByRole('heading', { name: /Topics \(/ });
    const energy = within(topics.closest('section')!)
      .getByRole('heading', { name: 'Energy' })
      .closest('article')!;
    expect(within(energy).queryByText('Your material')).toBeNull(); // computed only when opened
    await user.click(within(energy).getByText(/Why is it here/));
    expect(within(energy).getAllByText('Your material').length).toBeGreaterThan(0);
    expect(within(energy).getAllByText('Model’s guess').length).toBeGreaterThan(0);
    expect(within(energy).getAllByText('Calculated').length).toBeGreaterThan(0);
    expect(within(energy).getAllByText('Caveat').length).toBeGreaterThan(0);
  });
  it('explains why the next step is the next step', async () => {
    const user = userEvent.setup();
    render(<App runtimeFactory={factory(GOOD)} today={TODAY} storage={memoryStorage()} />);
    await pasteAndAnalyze(user);
    const next = (await screen.findByRole('heading', { name: 'Your next step' })).closest(
      'section',
    )!;
    await user.click(within(next).getByText(/Why this, and why now/));
    expect(within(next).getByText(/ranks \d+ of \d+ planned topics/)).toBeTruthy();
  });
  it('lists installed models in the picker and marks the unsupported ones as untested', async () => {
    render(
      <App
        runtimeFactory={factory(GOOD, {
          reachable: true,
          installed: true,
          models: ['gemma4:e4b', 'llama3:8b'],
        })}
        today={TODAY}
        storage={memoryStorage()}
      />,
    );
    const picker = (await screen.findByLabelText('Model')) as HTMLSelectElement;
    await waitFor(() => expect(within(picker).getByText('llama3:8b')).toBeTruthy());
    expect(within(picker).getByText(/Gemma 4 E4B \(default\) — installed/)).toBeTruthy();
    expect(within(picker).getByText(/Gemma 4 E2B \(lighter\) — not installed/)).toBeTruthy();
    const group = within(picker).getByText('llama3:8b').closest('optgroup')!;
    expect(group.label).toMatch(/not tested/);
  });
  it('an importance edit by the student is recorded as theirs', async () => {
    const user = userEvent.setup();
    render(<App runtimeFactory={factory(GOOD)} today={TODAY} storage={memoryStorage()} />);
    await pasteAndAnalyze(user);
    const topics = await screen.findByRole('heading', { name: /Topics \(/ });
    const energy = within(topics.closest('section')!)
      .getByRole('heading', { name: 'Energy' })
      .closest('article')!;
    await user.selectOptions(within(energy).getByLabelText('Importance'), 'high');
    expect(within(energy).getByText(/your choice; it was suggested as medium/)).toBeTruthy();
  });
});
