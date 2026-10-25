import { useState } from 'react';
import { SOURCE_LABEL, type ExplainLine } from '../core/explain';
import type { AnalysisReport } from '../ai/analyze';
import type { Plan } from '../core/planner';

/**
 * "Why?" disclosure: every line says where it came from (your material, you, the model, calculation, caveat).
 * The lines are only computed once the student opens it.
 */
export function WhyPanel({
  lines,
  summary = 'Why? Show the reasoning',
}: {
  lines: () => ExplainLine[];
  summary?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="why-panel"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{summary}</summary>
      {open && (
        <ul>
          {lines().map((l, i) => (
            <li key={i} className={`src-${l.source}`}>
              <span className={`tag tag-${l.source}`}>{SOURCE_LABEL[l.source]}</span>
              <span className="why-text">
                {l.text}
                {l.quote && <blockquote>{l.quote}</blockquote>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** Says where the topics came from whenever it is not a model run, so sample or rule-based topics are never mistaken for AI output. */
export function ProvenanceBanner({
  report,
  onClear,
}: {
  report: AnalysisReport | null;
  onClear: () => void;
}) {
  if (!report || !report.mode || report.mode === 'model') return null;
  if (report.mode === 'sample')
    return (
      <section className="card provenance sample" role="note" aria-label="Sample data notice">
        <p>
          <strong>Sample data.</strong> The topics below were written by hand, not produced by Gemma
          or any model. The quote checks, priorities and schedule are the app’s real code. One
          proposal is deliberately unsupported and one is weakly linked, to show what the checks do.
        </p>
        <div className="actions">
          <button type="button" onClick={onClear}>
            Clear the sample and use my own material
          </button>
        </div>
      </section>
    );
  return (
    <section className="card provenance outline" role="note" aria-label="Outline mode notice">
      <p>
        <strong>Outline mode (no AI).</strong> These topics were found by plain rules that read
        headings and “Week 3 – …” style lines. Effort and difficulty are rough guesses from section
        length. Run <em>Find my topics</em> with a model for a deeper reading.
      </p>
    </section>
  );
}

const FIT_TEXT = {
  done: ['Done', 'good'],
  fits: ['On track', 'good'],
  tight: ['Tight', 'warn'],
  overflow: ['Over capacity', 'bad'],
  'no-days': ['No study days', 'bad'],
} as const;

/** Progress at a glance: how much is done, what is left, how long until the exam, and whether it fits. */
export function ProgressCard({
  plan,
  doneMinutes,
  totalMinutes,
  daysToExam,
  minutesLabel,
}: {
  plan: Plan;
  doneMinutes: number;
  totalMinutes: number;
  daysToExam: number;
  minutesLabel: string;
}) {
  const [fitText, tone] = FIT_TEXT[plan.fit];
  return (
    <section className="card summary" aria-label="Progress">
      <p>
        <strong>{doneMinutes}</strong> of <strong>{totalMinutes}</strong> planned study minutes done
        · {minutesLabel} left · {plan.stats.studyDays} study day(s) until the exam
      </p>
      <progress max={Math.max(1, totalMinutes)} value={doneMinutes} aria-label="Study progress" />
      <p className="stats">
        <span className={`chip chip-${tone}`}>{fitText}</span>
        <span className="muted">
          {daysToExam} day{daysToExam === 1 ? '' : 's'} to the exam
        </span>
      </p>
    </section>
  );
}
