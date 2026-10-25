import { useEffect, useId, useState, type ReactNode } from 'react';
import { MAX_MATERIAL_CHARS } from '../ai/chunk';
import { formatDay, daysBetween, type ISODate } from '../core/dates';
import { LIMITS, type Plan, type PlanSettings, type PlanTask } from '../core/planner';
import { PRIORITY_DISCLAIMER, priorityOf } from '../core/priority';
import { EVIDENCE_FAILURE_TEXT } from '../core/evidence';
import { RECOMMENDED_MODELS } from '../ai/ollama';
import type { ProgressMap, Topic } from '../core/types';
import { explainTask, explainTopic } from '../core/explain';
import { SUPPORT_TEXT } from '../core/support';
import { WhyPanel } from './panels';
import type { Material, Settings } from './store';
import type { ModelState } from './useModelCheck';

export const dayLabel = (date: ISODate, today: ISODate): string => {
  const d = daysBetween(today, date);
  return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : formatDay(date);
};
export const minutesText = (m: number): string =>
  m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy =
    [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy })}
      {hint && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ModelStatus({
  state,
  model,
  onRecheck,
}: {
  state: ModelState;
  model: string;
  onRecheck: () => void;
}) {
  const pull = `ollama pull ${model.trim()}`;
  let text: string;
  let tone: 'ok' | 'warn' | 'bad' | 'wait' = 'wait';
  if (state === 'checking') text = 'Checking the local model…';
  else if (!state.reachable) {
    text = 'Ollama is not reachable';
    tone = 'bad';
  } else if (!state.installed) {
    text = `Ollama is running, but ${model.trim()} is not installed`;
    tone = 'warn';
  } else {
    text = `Ollama is running · ${model.trim()} is installed`;
    tone = 'ok';
  }
  return (
    <div className={`model-status tone-${tone}`} role="status">
      <span className="dot" aria-hidden="true" />
      <span>{text}</span>
      <button type="button" className="link" onClick={onRecheck}>
        Check again
      </button>
      {state !== 'checking' && !state.reachable && (
        <p className="hint">
          Start it with <code>ollama serve</code> (it may already run as a service), then press
          “Check again”. No model? Try the sample or outline mode below.
        </p>
      )}
      {state !== 'checking' && state.reachable && !state.installed && (
        <p className="hint">
          Install the model with <code>{pull}</code>, then press “Check again”.
        </p>
      )}
    </div>
  );
}

/**
 * Only offers what the app can actually use: the Gemma 4 tags it targets, plus whatever else is installed in
 * Ollama (labelled "not tested", since only Gemma 4 has been the target of this project).
 */
export function ModelPicker({
  value,
  state,
  onChange,
  disabled,
}: {
  value: string;
  state: ModelState;
  onChange: (model: string) => void;
  disabled: boolean;
}) {
  const installed = state === 'checking' ? [] : state.models;
  const has = (tag: string) => installed.some((m) => m === tag || m === `${tag}:latest`);
  const recommended = new Set(RECOMMENDED_MODELS.map((m) => m.tag));
  const others = installed.filter((m) => !recommended.has(m));
  const known = recommended.has(value) || others.includes(value);
  const known2 = known || others.includes(value.replace(/:latest$/, ''));
  return (
    <Field
      label="Model"
      hint={
        state !== 'checking' && !state.reachable
          ? 'Ollama is not reachable, so installed models cannot be listed.'
          : `Gemma 4 is what this app is built and checked for. To get the default: ollama pull ${RECOMMENDED_MODELS[0]!.tag}`
      }
    >
      {({ id, describedBy }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <optgroup label="Gemma 4 (recommended)">
            {RECOMMENDED_MODELS.map((m) => (
              <option key={m.tag} value={m.tag}>
                {m.label}
                {state === 'checking' ? '' : has(m.tag) ? ' — installed' : ' — not installed'}
              </option>
            ))}
          </optgroup>
          {others.length > 0 && (
            <optgroup label="Other models installed in Ollama (not tested)">
              {others.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </optgroup>
          )}
          {!known2 && (
            <optgroup label="Saved choice">
              <option value={value}>{value} — not installed</option>
            </optgroup>
          )}
        </select>
      )}
    </Field>
  );
}

export function SettingsForm({
  settings,
  errors,
  onChange,
  today,
}: {
  settings: Settings;
  errors: string[];
  onChange: (patch: Partial<Settings>) => void;
  today: ISODate;
}) {
  const num = (v: string) => (v.trim() === '' ? 0 : Number(v));
  const find = (re: RegExp) => errors.find((e) => re.test(e)) ?? null;
  return (
    <div className="grid">
      <Field
        label="What are you studying for?"
        hint="Optional. A short label, used in your export."
      >
        {({ id, describedBy }) => (
          <input
            id={id}
            aria-describedby={describedBy}
            maxLength={120}
            value={settings.goal}
            onChange={(e) => onChange({ goal: e.target.value })}
            placeholder="e.g. Physics mid-term"
          />
        )}
      </Field>
      <Field
        label="Exam date"
        error={find(/exam/i)}
        hint={`Today is ${formatDay(today)}. The exam day itself is not a study day.`}
      >
        {({ id, describedBy }) => (
          <input
            id={id}
            type="date"
            aria-describedby={describedBy}
            aria-invalid={!!find(/exam/i)}
            value={settings.examDate}
            onChange={(e) => onChange({ examDate: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="Study time per day (minutes)"
        error={find(/Daily study/)}
        hint="What you can realistically do on an ordinary day."
      >
        {({ id, describedBy }) => (
          <input
            id={id}
            type="number"
            inputMode="numeric"
            step={5}
            min={LIMITS.minMinutesPerDay}
            max={LIMITS.maxMinutesPerDay}
            aria-describedby={describedBy}
            aria-invalid={!!find(/Daily study/)}
            value={settings.minutesPerDay || ''}
            onChange={(e) => onChange({ minutesPerDay: num(e.target.value) })}
          />
        )}
      </Field>
      <Field
        label="Longest single session (minutes)"
        error={find(/Session length/)}
        hint="Longer topics are split into sessions of at most this length."
      >
        {({ id, describedBy }) => (
          <input
            id={id}
            type="number"
            inputMode="numeric"
            step={5}
            min={LIMITS.minSession}
            max={LIMITS.maxSession}
            aria-describedby={describedBy}
            aria-invalid={!!find(/Session length/)}
            value={settings.sessionMinutes || ''}
            onChange={(e) => onChange({ sessionMinutes: num(e.target.value) })}
          />
        )}
      </Field>
      <div className="wide">
        <Field
          label="Topics you already understand"
          hint="Optional. One per line or separated by commas. Matching topics are skipped."
        >
          {({ id, describedBy }) => (
            <textarea
              id={id}
              rows={2}
              aria-describedby={describedBy}
              value={settings.knownTopics}
              onChange={(e) => onChange({ knownTopics: e.target.value })}
            />
          )}
        </Field>
      </div>
    </div>
  );
}

export function MaterialPanel({
  material,
  error,
  onText,
  onFile,
  busy,
}: {
  material: Material;
  error: string | null;
  onText: (text: string) => void;
  onFile: (file: File) => void;
  busy: boolean;
}) {
  const length = material.text.length;
  return (
    <div>
      <Field
        label="Paste your syllabus or notes"
        error={error}
        hint={`Up to ${MAX_MATERIAL_CHARS.toLocaleString('en-US')} characters. You can edit the text, for example to fix extraction mistakes.`}
      >
        {({ id, describedBy }) => (
          <textarea
            id={id}
            rows={10}
            aria-describedby={describedBy}
            aria-invalid={!!error}
            value={material.text}
            onChange={(e) => onText(e.target.value)}
            disabled={busy}
          />
        )}
      </Field>
      <Field
        label="…or upload a text-based PDF"
        hint="Up to 10 MB and 60 pages. Scanned (image-only) PDFs have no text and cannot be read."
      >
        {({ id, describedBy }) => (
          <input
            id={id}
            type="file"
            accept="application/pdf,.pdf"
            aria-describedby={describedBy}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
        )}
      </Field>
      <p className="hint" aria-live="polite">
        {length === 0 ? 'No material yet.' : `${length.toLocaleString('en-US')} characters`}
        {material.source === 'pdf' && material.fileName
          ? ` · from ${material.fileName}${material.pageCount ? ` (${material.pageCount} pages)` : ''}`
          : ''}
        {material.lowTextPages ? ` · ${material.lowTextPages} page(s) had little or no text` : ''}
      </p>
    </div>
  );
}

export function NextTaskCard({
  task,
  topics,
  plan,
  settings,
  today,
  progress,
  onDone,
  onUndo,
  canUndo,
  headingRef,
}: {
  task: PlanTask | null;
  topics: Topic[];
  plan: Plan;
  settings: PlanSettings;
  today: ISODate;
  progress: ProgressMap;
  onDone: (t: PlanTask) => void;
  onUndo: () => void;
  canUndo: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const topic = task ? topics.find((t) => t.id === task.topicId) : undefined;
  return (
    <section className="card next" aria-labelledby="next-h">
      <h2 id="next-h" tabIndex={-1} ref={headingRef}>
        Your next step
      </h2>
      {!task || !topic ? (
        <p>
          {plan.fit === 'done'
            ? 'Nothing left to do. Everything you planned is studied and reviewed.'
            : plan.fit === 'no-days'
              ? 'There are no study days before the exam. Check the exam date, or move it later.'
              : 'Nothing is scheduled. Include a topic below, or check the dates.'}
        </p>
      ) : (
        <>
          <p className="when">
            {dayLabel(task.date, today)} · {minutesText(task.minutes)} ·{' '}
            {task.kind === 'study' ? 'Study' : 'Revise'}
          </p>
          <p className="big">
            {task.kind === 'study' ? 'Study' : 'Revise'}: {topic.name}
          </p>
          <Why task={task} topic={topic} topics={topics} settings={settings} progress={progress} />
          {topic.evidence && <Evidence topic={topic} />}
          <WhyPanel
            lines={() => explainTask(task, topic, topics, settings, progress, plan)}
            summary="Why this, and why now?"
          />
          <div className="actions">
            <button type="button" className="primary" onClick={() => onDone(task)}>
              Mark done ({minutesText(task.minutes)})
            </button>
            {canUndo && (
              <button type="button" onClick={onUndo}>
                Undo last
              </button>
            )}
          </div>
          {task.date > today && (
            <p className="hint">
              This is scheduled for {dayLabel(task.date, today).toLowerCase()}; marking it done now
              counts it as done today.
            </p>
          )}
        </>
      )}
      {(!task || !topic) && canUndo && (
        <div className="actions">
          <button type="button" onClick={onUndo}>
            Undo last
          </button>
        </div>
      )}
    </section>
  );
}

function Why({
  task,
  topic,
  topics,
  settings,
  progress,
}: {
  task: PlanTask;
  topic: Topic;
  topics: Topic[];
  settings: PlanSettings;
  progress: ProgressMap;
}) {
  if (task.kind === 'revision') {
    const k = task.reviewIndex ?? 0;
    const p = progress[topic.id];
    return (
      <p className="why">
        <strong>Why now:</strong> spaced revision {settings.revisionIntervals[k] ?? '?'} day(s)
        after you{' '}
        {p?.lastStudiedOn ? `studied it (${formatDay(p.lastStudiedOn)})` : 'finish studying it'}.
        This is a simple rule, not a guarantee.
      </p>
    );
  }
  const pr = priorityOf(topic, topics);
  return (
    <p className="why">
      <strong>Why now:</strong> {pr.level} priority —{' '}
      {pr.reasons.map((r) => `${r.label} (+${r.points})`).join(', ') || 'no special signals'}.
      {task.part && task.part.total > 1
        ? ` Session ${task.part.index} of ${task.part.total} for this topic.`
        : ''}
    </p>
  );
}

export function Evidence({ topic }: { topic: Topic }) {
  if (!topic.evidence) return null;
  const where = topic.evidence.page ? `PDF page ${topic.evidence.page}` : 'your material';
  return (
    <details className="evidence">
      <summary>Source passage ({where})</summary>
      <blockquote>{topic.evidence.quote}</blockquote>
      <p className="hint">
        Copied from your material and checked against it. The topic summary above is the model’s own
        wording.
      </p>
    </details>
  );
}

export function FitBanner({
  plan,
  settings,
  topics,
  onUseMinutes,
  suggestion,
}: {
  plan: Plan;
  settings: PlanSettings;
  topics: Topic[];
  onUseMinutes: (m: number) => void;
  suggestion: number | null;
}) {
  const name = (id: string) => topics.find((t) => t.id === id)?.name ?? id;
  if (plan.fit === 'overflow') {
    return (
      <section className="card warn" aria-labelledby="fit-h" role="region">
        <h2 id="fit-h">Not everything fits before the exam</h2>
        <p>
          {minutesText(plan.stats.unscheduledMinutes)} of study will not fit in{' '}
          {plan.stats.studyDays} day(s) at {minutesText(settings.minutesPerDay)} a day.
          Lower-priority topics are left out first, so the plan never promises more than your time
          allows.
        </p>
        <ul>
          {plan.unscheduled.map((u) => (
            <li key={u.topicId}>
              <strong>{name(u.topicId)}</strong>: {minutesText(u.minutes)} not scheduled
            </li>
          ))}
        </ul>
        <div className="actions">
          {suggestion !== null ? (
            <button type="button" onClick={() => onUseMinutes(suggestion)}>
              Use {minutesText(suggestion)} a day instead
            </button>
          ) : (
            <p className="hint">
              Even 8 hours a day would not fit everything. Mark topics you already know, or lower an
              estimate below.
            </p>
          )}
        </div>
      </section>
    );
  }
  if (plan.fit === 'tight')
    return (
      <section className="card note" role="region" aria-label="Plan fit">
        <p>
          <strong>This plan is tight.</strong> Almost all of your available time is used, so a
          missed day will push work out.
        </p>
      </section>
    );
  if (plan.droppedRevisions.length > 0) {
    return (
      <section className="card note" role="region" aria-label="Plan fit">
        <p>
          <strong>Some reviews were left out</strong> ({plan.droppedRevisions.length}) because there
          was no room or the exam is too close.
        </p>
      </section>
    );
  }
  return null;
}

export function ScheduleSection({
  plan,
  topics,
  today,
  onDone,
}: {
  plan: Plan;
  topics: Topic[];
  today: ISODate;
  onDone: (t: PlanTask) => void;
}) {
  const name = (id: string) => topics.find((t) => t.id === id)?.name ?? id;
  const busy = plan.days.filter((d) => d.tasks.length > 0);
  if (busy.length === 0) return null;
  return (
    <section className="card" aria-labelledby="sched-h">
      <h2 id="sched-h">Schedule</h2>
      <p className="hint">
        The plan is rebuilt from today every time, so anything you miss simply moves forward.
      </p>
      {busy.map((d, i) => (
        <details key={d.date} open={i === 0} className="day">
          <summary>
            {dayLabel(d.date, today)}{' '}
            <span className="muted">
              · {minutesText(d.usedMinutes)} of {minutesText(d.capacity)}
            </span>
          </summary>
          <ul className="tasks">
            {d.tasks.map((t) => (
              <li key={t.id}>
                <span className={`pill ${t.kind}`}>{t.kind === 'study' ? 'Study' : 'Revise'}</span>
                <span className="task-name">
                  {name(t.topicId)}
                  {t.kind === 'study' && t.part && t.part.total > 1
                    ? ` (${t.part.index}/${t.part.total})`
                    : ''}
                  {t.kind === 'revision' ? ` (review ${(t.reviewIndex ?? 0) + 1})` : ''}
                </span>
                <span className="muted">{minutesText(t.minutes)}</span>
                {d.date === today && (
                  <button
                    type="button"
                    className="small"
                    onClick={() => onDone(t)}
                    aria-label={`Mark done: ${t.kind === 'study' ? 'study' : 'revise'} ${name(t.topicId)}, ${minutesText(t.minutes)}`}
                  >
                    Done
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}

function MinutesInput({
  value,
  onCommit,
  label,
}: {
  value: number;
  onCommit: (n: number) => void;
  label: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const id = useId();
  return (
    <div className="inline-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        step={5}
        min={15}
        max={600}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(Number(text))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit(Number(text));
        }}
      />
    </div>
  );
}

const BASIS_TEXT = {
  material: 'from your material',
  model: 'the model’s guess',
  default: 'default: your material does not say',
  student: 'your choice',
} as const;

export function TopicCard({
  topic,
  topics,
  progress,
  settings,
  plan,
  onPatch,
}: {
  topic: Topic;
  topics: Topic[];
  progress: ProgressMap;
  settings: PlanSettings;
  plan: Plan | null;
  onPatch: (patch: Partial<Topic>) => void;
}) {
  const pr = priorityOf(topic, topics);
  const studied = Math.min(topic.minutes, progress[topic.id]?.studiedMinutes ?? 0);
  const impId = useId();
  const verified = topic.status === 'verified';
  return (
    <article className={`topic ${verified ? '' : 'held'}`}>
      <header>
        <h3>{topic.name}</h3>
        <span className={`badge ${verified ? 'good' : 'bad'}`}>
          {verified ? '✓ Found in your material' : '⚠ Not found in your material'}
        </span>
      </header>
      {topic.description && (
        <p>
          <span className="muted">Model’s summary:</span> {topic.description}
        </p>
      )}
      {verified ? (
        <Evidence topic={topic} />
      ) : (
        <p className="hint">
          Held back:{' '}
          {topic.unverifiedReason
            ? EVIDENCE_FAILURE_TEXT[topic.unverifiedReason]
            : 'no matching source passage'}
          . It is not in your plan unless you choose to include it.
        </p>
      )}
      {verified && topic.support === 'weak' && (
        <p className="flag" role="note">
          <strong>Check this one.</strong> {SUPPORT_TEXT.weak}
        </p>
      )}
      {verified && !topic.done && (
        <p className="hint">
          Priority: <strong>{pr.level}</strong> —{' '}
          {pr.reasons.map((r) => `${r.label} (+${r.points})`).join(', ') || 'no special signals'}.{' '}
          {PRIORITY_DISCLAIMER}
        </p>
      )}
      <div className="controls">
        <MinutesInput
          value={topic.minutes}
          label="Estimate (min)"
          onCommit={(n) => onPatch({ minutes: n })}
        />
        <div className="inline-field">
          <label htmlFor={impId}>Importance</label>
          <select
            id={impId}
            value={topic.importance}
            onChange={(e) => onPatch({ importance: e.target.value as Topic['importance'] })}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={topic.weak}
            onChange={(e) => onPatch({ weak: e.target.checked })}
          />{' '}
          Weak spot
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={topic.done}
            onChange={(e) => onPatch({ done: e.target.checked })}
          />{' '}
          Already know it
        </label>
        {!verified && (
          <label className="check">
            <input
              type="checkbox"
              checked={topic.include}
              onChange={(e) => onPatch({ include: e.target.checked })}
            />{' '}
            Plan it anyway
          </label>
        )}
      </div>
      {verified && topic.importanceBasis && (
        <p className="hint">
          Importance is <strong>{topic.importance}</strong> ({BASIS_TEXT[topic.importanceBasis]}
          {topic.importanceBasis === 'student' &&
          topic.suggestedImportance &&
          topic.suggestedImportance !== topic.importance
            ? `; it was suggested as ${topic.suggestedImportance}`
            : ''}
          ).
        </p>
      )}
      {studied > 0 && (
        <div className="topic-progress">
          <progress max={topic.minutes} value={studied} aria-label={`${topic.name} progress`} />
          <span className="hint">
            {studied} of {topic.minutes} min studied.
          </span>
        </div>
      )}
      <WhyPanel
        lines={() => explainTopic(topic, topics, settings, progress, plan)}
        summary="Why is it here? Show the reasoning"
      />
    </article>
  );
}
