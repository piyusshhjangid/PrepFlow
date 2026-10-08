import {
  computeAvailability,
  createProfileInputSchema,
  isValidIsoDate,
  todayIso,
  updateExamInputSchema,
  type ExamResponse,
} from '@prepflow/shared';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/endpoints';
import { ApiError } from '../api/http';
import { Alert, Button, Card } from '../components/ui';
import { formatMinutes, plural } from '../lib/format';
import { clearExamId, getExamId, setExamId } from '../workspace';

interface FormState {
  nickname: string;
  examName: string;
  examDate: string;
  hours: string;
  studyDays: number[];
  weakText: string;
  confidence: string;
  bufferPct: string;
  daysOffText: string;
}

type FieldKey =
  | 'nickname'
  | 'examName'
  | 'examDate'
  | 'minutesPerDay'
  | 'studyDays'
  | 'weakTopicHints'
  | 'confidence'
  | 'bufferPct'
  | 'blockedDates';
type FieldErrors = Partial<Record<FieldKey, string>>;

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
/** Monday first for display; values are JavaScript weekdays (0 = Sunday). */
const WEEKDAYS: ReadonlyArray<readonly [number, string]> = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
];
const EMPTY: FormState = {
  nickname: '',
  examName: '',
  examDate: '',
  hours: '3',
  studyDays: ALL_DAYS,
  weakText: '',
  confidence: '',
  bufferPct: '10',
  daysOffText: '',
};

const FIELD_KEYS: readonly string[] = [
  'nickname',
  'examName',
  'examDate',
  'minutesPerDay',
  'studyDays',
  'weakTopicHints',
  'confidence',
  'bufferPct',
  'blockedDates',
];

function splitHints(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((hint) => hint.trim())
    .filter(Boolean);
}

function parseHours(value: string): number | null {
  const hours = Number(value);
  return value.trim() !== '' && Number.isFinite(hours) ? Math.round(hours * 60) : null;
}

function fromExam(exam: ExamResponse): FormState {
  return {
    nickname: exam.nickname,
    examName: exam.name,
    examDate: exam.examDate,
    hours: String(exam.minutesPerDay / 60),
    studyDays: exam.studyDays,
    weakText: exam.weakTopicHints.join('\n'),
    confidence: exam.confidence === null ? '' : String(exam.confidence),
    bufferPct: String(exam.bufferPct),
    daysOffText: exam.blockedDates.join('\n'),
  };
}

/** Turns zod issues (client or server) into one message per form field. */
function issuesToErrors(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = String(issue.path[0]);
    if (FIELD_KEYS.includes(key) && !errors[key as FieldKey])
      errors[key as FieldKey] = issue.message;
  }
  return errors;
}

type LoadState = 'loading' | 'ready' | 'failed';

export function SetupPage() {
  const navigate = useNavigate();
  const [existingId] = useState(() => getExamId());
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [load, setLoad] = useState<LoadState>(existingId ? 'loading' : 'ready');
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!existingId) return;
    let cancelled = false;
    setLoad('loading');
    api
      .getExam(existingId)
      .then((exam) => {
        if (cancelled) return;
        setForm(fromExam(exam));
        setMode('edit');
        setLoad('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.code === 'EXAM_NOT_FOUND') {
          clearExamId();
          setNotice('We couldn’t find your previous setup, so let’s start a new one.');
          setLoad('ready');
          return;
        }
        setLoadError(
          error instanceof ApiError ? error.message : 'Something went wrong loading your setup.',
        );
        setLoad('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [existingId]);

  const preview = useMemo(() => {
    const minutesPerDay = parseHours(form.hours);
    if (!isValidIsoDate(form.examDate) || minutesPerDay === null || minutesPerDay <= 0) return null;
    return computeAvailability({
      today: todayIso(),
      examDate: form.examDate,
      studyWeekdays: form.studyDays,
      minutesPerDay,
    });
  }, [form.examDate, form.hours, form.studyDays]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleDay(day: number) {
    update(
      'studyDays',
      form.studyDays.includes(day)
        ? form.studyDays.filter((d) => d !== day)
        : [...form.studyDays, day],
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError('');

    const minutesPerDay = parseHours(form.hours);
    const early: FieldErrors = {};
    if (!form.examDate) early.examDate = 'Pick your exam date.';
    if (minutesPerDay === null)
      early.minutesPerDay = 'Enter how many hours you can study per day, for example 2.5.';
    if (Object.keys(early).length > 0 || minutesPerDay === null) {
      setErrors(early);
      return;
    }

    const common = {
      examName: form.examName,
      examDate: form.examDate,
      minutesPerDay,
      studyDays: form.studyDays,
      weakTopicHints: splitHints(form.weakText),
      bufferPct: Number(form.bufferPct),
      blockedDates: splitHints(form.daysOffText),
    };
    const confidence = form.confidence === '' ? undefined : Number(form.confidence);

    const parsed =
      mode === 'edit'
        ? updateExamInputSchema.safeParse({ ...common, confidence: confidence ?? null })
        : createProfileInputSchema.safeParse({ ...common, nickname: form.nickname, confidence });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});

    setBusy(true);
    try {
      if (mode === 'edit' && existingId) {
        await api.updateExam(existingId, parsed.data as Parameters<typeof api.updateExam>[1]);
      } else {
        const created = await api.createProfile(
          parsed.data as Parameters<typeof api.createProfile>[0],
        );
        setExamId(created.exam.id);
      }
      navigate('/material');
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'VALIDATION_ERROR' && Array.isArray(error.details)) {
          setErrors(
            issuesToErrors(error.details as Array<{ path: PropertyKey[]; message: string }>),
          );
          setFormError('Some answers need another look. They’re marked below.');
        } else if (error.code.startsWith('EXAM_DATE')) {
          setErrors({ examDate: error.message });
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError('Something went wrong saving your setup. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (load === 'loading') return <p className="text-sm text-slate-600">Loading your setup…</p>;
  if (load === 'failed') {
    return (
      <Card title="We couldn’t load your setup">
        <p className="mb-4 text-sm text-slate-600">{loadError}</p>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === 'edit' ? 'Edit your study setup' : 'Set up your exam'}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          A few quick answers so PrepFlow can plan around the time you really have.
        </p>
      </div>

      {notice && <Alert kind="info">{notice}</Alert>}
      {formError && <Alert kind="error">{formError}</Alert>}

      <Card>
        <div className="space-y-5">
          {mode === 'create' ? (
            <Field id="nickname" label="What should we call you?" error={errors.nickname}>
              <input
                id="nickname"
                type="text"
                autoComplete="given-name"
                maxLength={40}
                value={form.nickname}
                onChange={(e) => update('nickname', e.target.value)}
                className={inputClass}
                aria-invalid={Boolean(errors.nickname)}
                aria-describedby={errors.nickname ? 'nickname-error' : undefined}
              />
            </Field>
          ) : (
            <p className="text-sm text-slate-600">
              Studying as <strong>{form.nickname}</strong>
            </p>
          )}

          <Field id="examName" label="What are you preparing for?" error={errors.examName}>
            <input
              id="examName"
              type="text"
              placeholder="e.g. Semester 5 exams"
              maxLength={100}
              value={form.examName}
              onChange={(e) => update('examName', e.target.value)}
              className={inputClass}
              aria-invalid={Boolean(errors.examName)}
              aria-describedby={errors.examName ? 'examName-error' : undefined}
            />
          </Field>

          <Field
            id="examDate"
            label="When is the exam?"
            hint="The exam day itself isn’t counted as a study day."
            error={errors.examDate}
          >
            <input
              id="examDate"
              type="date"
              min={todayIso()}
              value={form.examDate}
              onChange={(e) => update('examDate', e.target.value)}
              className={inputClass}
              aria-invalid={Boolean(errors.examDate)}
              aria-describedby={errors.examDate ? 'examDate-error' : 'examDate-hint'}
            />
          </Field>

          <Field
            id="hours"
            label="How many hours can you study each day?"
            error={errors.minutesPerDay}
          >
            <input
              id="hours"
              type="number"
              inputMode="decimal"
              min={0.25}
              max={12}
              step={0.25}
              value={form.hours}
              onChange={(e) => update('hours', e.target.value)}
              className={`${inputClass} max-w-[8rem]`}
              aria-invalid={Boolean(errors.minutesPerDay)}
              aria-describedby={errors.minutesPerDay ? 'hours-error' : undefined}
            />
          </Field>

          <fieldset aria-describedby={errors.studyDays ? 'studyDays-error' : undefined}>
            <legend className="mb-2 text-sm font-medium">Which days can you study?</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map(([day, label]) => (
                <label
                  key={day}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm has-[:checked]:border-indigo-600 has-[:checked]:bg-indigo-50"
                >
                  <input
                    type="checkbox"
                    checked={form.studyDays.includes(day)}
                    onChange={() => toggleDay(day)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {errors.studyDays && (
              <p id="studyDays-error" className="mt-1 text-sm text-red-700">
                {errors.studyDays}
              </p>
            )}
          </fieldset>

          {preview && <AvailabilityPreview availability={preview} />}
        </div>
      </Card>

      <Card title="Optional: help PrepFlow focus">
        <div className="space-y-5">
          <Field
            id="weak"
            label="Which subjects or topics feel difficult?"
            hint="One per line, or separated by commas."
            error={errors.weakTopicHints}
          >
            <textarea
              id="weak"
              rows={3}
              value={form.weakText}
              onChange={(e) => update('weakText', e.target.value)}
              className={inputClass}
              aria-describedby={errors.weakTopicHints ? 'weak-error' : 'weak-hint'}
            />
          </Field>

          <Field
            id="confidence"
            label="How prepared do you feel right now?"
            error={errors.confidence}
          >
            <select
              id="confidence"
              value={form.confidence}
              onChange={(e) => update('confidence', e.target.value)}
              className={`${inputClass} max-w-xs`}
            >
              <option value="">Prefer not to say</option>
              <option value="1">1 – Not prepared</option>
              <option value="2">2 – A little</option>
              <option value="3">3 – Somewhat</option>
              <option value="4">4 – Fairly well</option>
              <option value="5">5 – Very well</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Planning options">
        <div className="space-y-5">
          <Field
            id="bufferPct"
            label="How much of each day should PrepFlow keep free?"
            hint="This slack is never scheduled. It absorbs delays and lets missed tasks be moved without overloading later days."
            error={errors.bufferPct}
          >
            <select
              id="bufferPct"
              value={form.bufferPct}
              onChange={(e) => update('bufferPct', e.target.value)}
              className={`${inputClass} max-w-xs`}
              aria-describedby="bufferPct-hint"
            >
              {[0, 5, 10, 15, 20, 30].map((pct) => (
                <option key={pct} value={String(pct)}>
                  {pct === 0 ? 'None (plan every minute)' : `${pct}%`}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="daysOff"
            label="Specific days you can’t study"
            hint="Dates as YYYY-MM-DD, one per line or separated by commas (for example a wedding or a trip)."
            error={errors.blockedDates}
          >
            <textarea
              id="daysOff"
              rows={2}
              value={form.daysOffText}
              onChange={(e) => update('daysOffText', e.target.value)}
              className={inputClass}
              aria-describedby={errors.blockedDates ? 'daysOff-error' : 'daysOff-hint'}
            />
          </Field>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" busy={busy}>
          {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Continue to material'}
        </Button>
        {mode === 'edit' && (
          <Button variant="secondary" onClick={() => navigate('/material')} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

const inputClass =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm aria-[invalid=true]:border-red-500';

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function AvailabilityPreview({
  availability,
}: {
  availability: { daysUntilExam: number; studyDays: number; availableMinutes: number };
}) {
  const { daysUntilExam, studyDays, availableMinutes } = availability;
  if (daysUntilExam <= 0) {
    return <Alert kind="warning">That date leaves no days to study before the exam.</Alert>;
  }
  if (studyDays === 0) {
    return (
      <Alert kind="warning">
        None of your study days fall before the exam. Add more days, or check the exam date.
      </Alert>
    );
  }
  return (
    <Alert kind={studyDays <= 2 ? 'warning' : 'info'}>
      {studyDays <= 2 ? 'Very little time: ' : ''}
      {plural(studyDays, 'study day')} before the exam, about{' '}
      <strong>{formatMinutes(availableMinutes)}</strong> available in total.
    </Alert>
  );
}
