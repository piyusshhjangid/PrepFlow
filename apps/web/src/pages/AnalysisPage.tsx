import {
  ANALYSIS_STAGES,
  type AnalysisResultResponse,
  type AnalysisRunSummary,
  type AnalyzedTopic,
  type ExamResponse,
  type ListMaterialsResponse,
  type ReviewTopicInput,
} from '@prepflow/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api } from '../api/endpoints';
import { ApiError } from '../api/http';
import { EvidenceList } from '../components/Evidence';
import { Alert, Button, Card, LinkButton } from '../components/ui';
import { formatMinutes, plural } from '../lib/format';
import { clearExamId, getExamId } from '../workspace';

/** How often the page asks the server for the run's real state while it is active. */
export const POLL_INTERVAL_MS = 2000;

type Data = {
  exam: ExamResponse;
  materials: ListMaterialsResponse;
  run: AnalysisRunSummary | null;
  result: AnalysisResultResponse;
};
type LoadState =
  { kind: 'loading' } | { kind: 'ready'; data: Data } | { kind: 'error'; message: string };

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
const isActive = (run: AnalysisRunSummary | null) =>
  run?.status === 'QUEUED' || run?.status === 'RUNNING';

const STAGE_LABELS: Record<(typeof ANALYSIS_STAGES)[number], string> = {
  LOADING: 'Loading your material',
  CHUNKING: 'Splitting it into sections',
  ANALYZING: 'Reading sections with the AI model',
  VALIDATING: 'Checking every quote against your material',
  MERGING: 'Merging topics across materials',
  PERSISTING: 'Saving results',
  COMPLETED: 'Done',
};

const WARNING_TEXT: Record<string, string> = {
  CHUNK_FAILED: 'Some sections could not be analyzed, so topics from them may be missing.',
  TOPICS_DROPPED:
    'Some topics suggested by the AI were discarded because they were malformed or could not be verified in your material.',
};

export function AnalysisPage() {
  const examId = getExamId();
  if (!examId) return <Navigate to="/setup" replace />;
  return <AnalysisScreen examId={examId} />;
}

function AnalysisScreen({ examId }: { examId: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [missing, setMissing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; message: string } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchAll = useCallback(async (): Promise<Data> => {
    const [exam, materials, latest, result] = await Promise.all([
      api.getExam(examId),
      api.listMaterials(examId),
      api.latestAnalysis(examId),
      api.analysisResult(examId),
    ]);
    return { exam, materials, run: latest.run, result };
  }, [examId]);

  const load = useCallback(async () => {
    try {
      const data = await fetchAll();
      if (mounted.current) setState({ kind: 'ready', data });
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiError && error.code === 'EXAM_NOT_FOUND') {
        clearExamId();
        setMissing(true);
        return;
      }
      setState({ kind: 'error', message: messageOf(error) });
    }
  }, [fetchAll]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while the SERVER says a run is active. The state shown is always the server's state.
  const active = state.kind === 'ready' && isActive(state.data.run);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const latest = await api.latestAnalysis(examId);
          if (stopped || !mounted.current) return;
          if (isActive(latest.run)) {
            setState((current) =>
              current.kind === 'ready'
                ? { kind: 'ready', data: { ...current.data, run: latest.run } }
                : current,
            );
          } else {
            // The run finished: fetch the final run and the stored result.
            const data = await fetchAll();
            if (!stopped && mounted.current) setState({ kind: 'ready', data });
          }
        } catch {
          // A failed poll is not a failed analysis. Keep showing the last known state and try again.
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, examId, fetchAll]);

  if (missing) return <Navigate to="/setup" replace />;
  if (state.kind === 'loading') return <p className="text-sm text-slate-600">Loading…</p>;
  if (state.kind === 'error')
    return (
      <Card title="We couldn’t load this page">
        <p className="mb-4 text-sm text-slate-600">{state.message}</p>
        <Button onClick={() => void load()}>Try again</Button>
      </Card>
    );

  const { exam, materials, run, result } = state.data;
  const hasMaterial = materials.materials.length > 0;

  async function start() {
    setStarting(true);
    setNotice(null);
    try {
      const response = await api.startAnalysis(examId);
      if (response.reused) {
        setNotice({
          kind: 'info',
          message:
            'Your material and settings haven’t changed, so the existing analysis is still current.',
        });
      } else if (response.alreadyRunning) {
        setNotice({
          kind: 'info',
          message: 'An analysis is already running. Showing its progress.',
        });
      }
      setState((current) =>
        current.kind === 'ready'
          ? { kind: 'ready', data: { ...current.data, run: response.run } }
          : current,
      );
      if (response.reused) await load();
    } catch (error) {
      setNotice({ kind: 'error', message: messageOf(error) });
    } finally {
      if (mounted.current) setStarting(false);
    }
  }

  async function updateTopic(topicId: string, input: ReviewTopicInput) {
    const updated = await api.updateTopic(examId, topicId, input);
    setState((current) =>
      current.kind === 'ready'
        ? { ...current, data: { ...current.data, result: updated } }
        : current,
    );
    setNotice({ kind: 'info', message: 'Topic saved. Rebalance your plan to apply the changes.' });
  }

  async function deleteTopic(topicId: string) {
    await api.deleteTopic(examId, topicId);
    await load();
    setNotice({
      kind: 'info',
      message: 'Topic deleted. Rebalance your plan to apply the changes.',
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analyze your material</h1>
        <p className="mt-1 text-sm text-slate-600">
          {exam.name}: {plural(materials.materials.length, 'material')}. An open-weight Gemma model
          finds the subjects and topics; every topic must be backed by a quote PrepFlow can find in
          your material.
        </p>
        <p className="mt-1 text-sm">
          <Link to="/material" className="font-medium text-indigo-700 underline">
            Manage material
          </Link>
        </p>
      </div>

      {notice && <Alert kind={notice.kind}>{notice.message}</Alert>}

      <Card title="Analysis">
        <div className="space-y-4">
          {run && <RunStatus run={run} />}
          {!hasMaterial && (
            <Alert kind="warning">
              Add some study material first.{' '}
              <Link to="/material" className="font-medium underline">
                Add material
              </Link>
            </Alert>
          )}
          <Button
            onClick={() => void start()}
            busy={starting || isActive(run)}
            disabled={!hasMaterial}
          >
            {isActive(run) ? 'Analysis running…' : run ? 'Analyze again' : 'Start analysis'}
          </Button>
        </div>
      </Card>

      {result.subjects.length > 0 && (
        <Card title="Next step">
          <p className="mb-3 text-sm text-slate-600">
            Turn these topics into a study plan that fits your exam date and daily time.
          </p>
          <LinkButton to="/plan">Build your study plan</LinkButton>
        </Card>
      )}
      {result.subjects.length > 0 && (
        <Results result={result} onUpdate={updateTopic} onDelete={deleteTopic} />
      )}
    </div>
  );
}

function RunStatus({ run }: { run: AnalysisRunSummary }) {
  const activeRun = isActive(run);
  const currentIndex = run.stage ? ANALYSIS_STAGES.indexOf(run.stage) : -1;
  return (
    <div className="space-y-3" aria-live="polite">
      {run.status === 'QUEUED' && <p className="text-sm text-slate-700">Waiting to start…</p>}
      {activeRun && run.status === 'RUNNING' && (
        <ol className="space-y-1 text-sm" aria-label="Analysis progress">
          {ANALYSIS_STAGES.filter((stage) => stage !== 'COMPLETED').map((stage, index) => {
            const state =
              index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
            return (
              <li
                key={stage}
                aria-current={state === 'current' ? 'step' : undefined}
                className={
                  state === 'current'
                    ? 'font-medium text-indigo-800'
                    : state === 'done'
                      ? 'text-slate-500'
                      : 'text-slate-400'
                }
              >
                <span aria-hidden="true">
                  {state === 'done' ? '✓ ' : state === 'current' ? '▶ ' : '○ '}
                </span>
                {STAGE_LABELS[stage]}
                {state === 'current' && stage === 'ANALYZING' && run.totalChunks > 0 && (
                  <span className="ml-2 text-slate-600">
                    (section {Math.min(run.processedChunks + 1, run.totalChunks)} of{' '}
                    {run.totalChunks})
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {run.status === 'SUCCEEDED' && (
        <Alert kind="success">
          Analysis complete: {plural(run.topicCount, 'topic')} found
          {run.latencyMs !== null ? ` in ${Math.max(1, Math.round(run.latencyMs / 1000))}s` : ''}.
        </Alert>
      )}
      {run.status === 'PARTIAL' && (
        <Alert kind="warning">
          Analysis finished with problems: {plural(run.topicCount, 'topic')} saved, but{' '}
          {plural(run.failedChunks, 'section')} could not be analyzed.
        </Alert>
      )}
      {run.status === 'FAILED' && (
        <Alert kind="error">
          <strong className="font-semibold">Analysis failed.</strong>{' '}
          {run.errorMessage ?? 'Something went wrong. Please try again.'}
        </Alert>
      )}
      {run.warnings
        .filter((warning) => WARNING_TEXT[warning])
        .map((warning) => (
          <Alert key={warning} kind="warning">
            {WARNING_TEXT[warning]}
            {warning === 'TOPICS_DROPPED' && run.droppedTopics > 0 ? ` (${run.droppedTopics})` : ''}
          </Alert>
        ))}
      {run.provider && (
        <p className="text-xs text-slate-500">
          Model: {run.provider} · {run.model}
        </p>
      )}
    </div>
  );
}

const BADGE: Record<string, string> = {
  EASY: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  MEDIUM: 'bg-amber-50 text-amber-800 border-amber-200',
  HARD: 'bg-red-50 text-red-800 border-red-200',
  LOW: 'bg-slate-50 text-slate-700 border-slate-200',
  HIGH: 'bg-indigo-50 text-indigo-800 border-indigo-200',
};
const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

function Badge({ title, value }: { title: string; value: string }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-xs ${BADGE[value] ?? BADGE.LOW}`}>
      {title}: {label(value)}
    </span>
  );
}

function Results({
  result,
  onUpdate,
  onDelete,
}: {
  result: AnalysisResultResponse;
  onUpdate: (topicId: string, input: ReviewTopicInput) => Promise<void>;
  onDelete: (topicId: string) => Promise<void>;
}) {
  const total = result.subjects.reduce((sum, subject) => sum + subject.topics.length, 0);
  return (
    <section className="space-y-4" aria-label="Analysis results">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {plural(total, 'topic')} in {plural(result.subjects.length, 'subject')}
        </h2>
        <p className="text-sm text-slate-600">
          About {formatMinutes(result.totalEstimatedMinutes)} of first-pass study. Time estimates
          are calculated by PrepFlow from the AI’s classification, not written by the AI.
        </p>
      </div>
      {result.subjects.map((subject) => (
        <Card key={subject.id} title={subject.name}>
          <ul className="divide-y divide-slate-100">
            {subject.topics.map((topic) => (
              <TopicRow key={topic.id} topic={topic} onUpdate={onUpdate} onDelete={onDelete} />
            ))}
          </ul>
        </Card>
      ))}
    </section>
  );
}

function TopicRow({
  topic,
  onUpdate,
  onDelete,
}: {
  topic: AnalyzedTopic;
  onUpdate: (topicId: string, input: ReviewTopicInput) => Promise<void>;
  onDelete: (topicId: string) => Promise<void>;
}) {
  const [minutes, setMinutes] = useState(topic.estimatedMinutes);
  const [importance, setImportance] = useState(topic.importance);
  const [isWeak, setIsWeak] = useState(topic.isWeak);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onUpdate(topic.id, { estimatedMinutes: minutes, importance, isWeak });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete “${topic.name}” from this analysis?`)) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(topic.id);
    } catch (cause) {
      setError(messageOf(cause));
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{topic.name}</h3>
        {topic.isWeak && (
          <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-xs text-rose-800">
            Weak topic{topic.weakHint ? `: matches “${topic.weakHint}”` : ''}
          </span>
        )}
        {topic.statedEmphasis && (
          <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-800">
            Emphasized in material
          </span>
        )}
        {topic.origin === 'INFERRED' && (
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700">
            Inferred
          </span>
        )}
      </div>
      {topic.parent && <p className="text-xs text-slate-500">Part of: {topic.parent}</p>}
      {topic.description && <p className="mt-1 text-sm text-slate-700">{topic.description}</p>}
      {!topic.statedEmphasis && topic.evidence.some((item) => item.support) && (
        <p className="mt-1 text-xs text-slate-600">
          No exam-importance wording was found in the material, so this topic has no
          material-emphasis boost.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge title="Difficulty" value={topic.difficulty} />
        <Badge title="Importance" value={topic.importance} />
        <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700">
          ~{formatMinutes(topic.estimatedMinutes)}
        </span>
        <span
          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700"
          title="How sure the AI was that this is a distinct topic. It does not affect scheduling."
        >
          AI confidence: {Math.round(topic.confidence * 100)}%
        </span>
      </div>
      {topic.prerequisites.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">Needs first: {topic.prerequisites.join(', ')}</p>
      )}
      <EvidenceList evidence={topic.evidence} />
      <fieldset className="mt-3 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold text-slate-700">Review this topic</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-medium text-slate-700">
            Importance / priority
            <select
              value={importance}
              onChange={(event) => setImportance(event.target.value as typeof importance)}
              className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              disabled={busy}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-700">
            Study minutes
            <input
              type="number"
              min={5}
              max={1440}
              step={5}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
              className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm"
              disabled={busy}
            />
          </label>
          <label className="flex items-center gap-2 pb-1 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isWeak}
              onChange={(event) => setIsWeak(event.target.checked)}
              disabled={busy}
            />
            Weak topic
          </label>
          <Button onClick={() => void save()} busy={busy} className="px-3 py-1.5">
            Save changes
          </Button>
          <Button
            variant="danger"
            onClick={() => void remove()}
            busy={busy}
            className="px-3 py-1.5"
          >
            Delete topic
          </Button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-xs text-red-800">
            {error}
          </p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Changes affect priority and study time after you rebalance the plan.
        </p>
      </fieldset>
    </li>
  );
}
