import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { analyzeMaterial, outlineMaterial, type AnalysisProgress } from '../ai/analyze';
import { isAiError } from '../ai/errors';
import { validateMaterial } from '../ai/chunk';
import { daysBetween, localToday, type ISODate } from '../core/dates';
import { loadSample } from '../demo/sample';
import { exportMarkdown } from '../core/export';
import {
  buildPlan,
  DEFAULTS,
  nextTask,
  suggestAdjustment,
  validateSettings,
  type PlanSettings,
  type PlanTask,
} from '../core/planner';
import { isActive } from '../core/priority';
import { PdfError, extractPdfText, type PdfLib } from '../core/pdf';
import { applyKnownTopics } from '../core/topics';
import {
  FitBanner,
  MaterialPanel,
  ModelPicker,
  ModelStatus,
  NextTaskCard,
  ScheduleSection,
  SettingsForm,
  TopicCard,
  minutesText,
} from './parts';
import { ProgressCard, ProvenanceBanner } from './panels';
import { loadPdfLib, ollamaRuntime, type RuntimeFactory } from './runtime';
import { clearState, initialState, loadState, reducer, saveState } from './store';
import { useModelCheck, type ModelState } from './useModelCheck';

export interface AppProps {
  runtimeFactory?: RuntimeFactory;
  today?: ISODate;
  storage?: Storage;
  pdfLoader?: () => Promise<PdfLib>;
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

type Analysis =
  | { status: 'idle' }
  | { status: 'running'; progress: AnalysisProgress | 'checking' }
  | { status: 'error'; message: string }
  | { status: 'notopics'; mode: 'model' | 'outline' };

/** Re-renders when the tab becomes visible again, so "today" is right after midnight or a long sleep. */
function useDayRefresh(enabled: boolean) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState !== 'hidden') bump((n) => n + 1);
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled]);
}

function AnalyzeControls({
  variant,
  model,
  modelState,
  analysis,
  running,
  busy,
  onModel,
  onAnalyze,
  onOutline,
  onCancel,
}: {
  variant: 'first' | 'again';
  model: string;
  modelState: ModelState;
  analysis: Analysis;
  running: boolean;
  busy: boolean;
  onModel: (m: string) => void;
  onAnalyze: () => void;
  onOutline: () => void;
  onCancel: () => void;
}) {
  const label = variant === 'first' ? 'Find my topics' : 'Analyze again';
  return (
    <div className="analyze">
      <ModelPicker value={model} state={modelState} onChange={onModel} disabled={running} />
      <div className="actions">
        <button
          type="button"
          className={variant === 'first' ? 'primary' : undefined}
          onClick={onAnalyze}
          disabled={running || busy}
        >
          {running ? 'Analyzing…' : label}
        </button>
        <button type="button" onClick={onOutline} disabled={running || busy}>
          Outline mode (no AI)
        </button>
        {running && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <p className="hint">
        Outline mode needs no model: it reads headings and “Week 3 – …” style lines with plain
        rules. It finds little in unstructured notes.
      </p>
      <div aria-live="polite" className="status-line">
        {analysis.status === 'running' && (
          <p>
            {analysis.progress === 'checking'
              ? 'Checking the local model…'
              : analysis.progress.phase === 'analyzing'
                ? `Reading part ${analysis.progress.chunk} of ${analysis.progress.chunks} with ${model.trim()}. Small models on a laptop can take a minute or more per part.`
                : analysis.progress.phase === 'verifying'
                  ? 'Checking every topic against your material…'
                  : 'Preparing your material…'}
          </p>
        )}
      </div>
      {analysis.status === 'error' && (
        <p className="error" role="alert">
          {analysis.message}
        </p>
      )}
      {analysis.status === 'notopics' && (
        <p className="error" role="alert">
          {analysis.mode === 'outline'
            ? 'Outline mode found no headings or “Week 1 – …” lines it could use, so nothing was changed. Try a model, or add labelled lines.'
            : 'No topic could be tied to a passage in your material, so nothing was added. Try more detailed notes, a different model, or outline mode.'}
        </p>
      )}
    </div>
  );
}

export function App({
  runtimeFactory = ollamaRuntime,
  today: todayProp,
  storage: storageProp,
  pdfLoader = loadPdfLib,
}: AppProps) {
  useDayRefresh(todayProp === undefined);
  const today = todayProp ?? localToday();
  const storage = storageProp ?? browserStorage();
  const [state, dispatch] = useReducer(reducer, undefined, () => loadState(storage, today));
  const [analysis, setAnalysis] = useState<Analysis>({ status: 'idle' });
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [exportNote, setExportNote] = useState('');
  const [storageOk, setStorageOk] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const nextHeading = useRef<HTMLHeadingElement | null>(null);
  const focusNext = useRef(false);

  useEffect(() => {
    setStorageOk(saveState(storage, state) || storage === undefined);
  }, [state, storage]);

  const { settings, topics, progress, material } = state;
  const { state: modelState, recheck } = useModelCheck(runtimeFactory, settings.model);
  const planSettings: PlanSettings = useMemo(
    () => ({
      today,
      examDate: settings.examDate,
      minutesPerDay: settings.minutesPerDay,
      sessionMinutes: settings.sessionMinutes,
      revisionIntervals: [...DEFAULTS.revisionIntervals],
    }),
    [today, settings.examDate, settings.minutesPerDay, settings.sessionMinutes],
  );
  const settingsErrors = useMemo(() => validateSettings(planSettings), [planSettings]);
  const plan = useMemo(
    () =>
      settingsErrors.length === 0 && topics.length > 0
        ? buildPlan(topics, planSettings, progress)
        : null,
    [settingsErrors, topics, planSettings, progress],
  );
  const suggestion = useMemo(
    () =>
      plan?.fit === 'overflow'
        ? suggestAdjustment(topics, planSettings, progress).minutesPerDayToFitAll
        : null,
    [plan, topics, planSettings, progress],
  );
  const task = plan ? nextTask(plan) : null;

  useEffect(() => {
    if (focusNext.current && topics.length > 0) {
      focusNext.current = false;
      nextHeading.current?.focus();
    }
  }, [topics]);

  async function analyze() {
    const problem = validateMaterial(material.text);
    if (problem) return setMaterialError(problem);
    setMaterialError(null);
    if (settingsErrors.length > 0)
      return setAnalysis({ status: 'error', message: settingsErrors[0]! });
    const controller = new AbortController();
    abort.current = controller;
    setAnalysis({ status: 'running', progress: 'checking' });
    try {
      const runtime = runtimeFactory(settings.model.trim());
      const check = await runtime.check();
      if (!check.reachable)
        return setAnalysis({
          status: 'error',
          message:
            'Could not reach the local model runtime (Ollama). Start Ollama and try again, or use outline mode (no AI) now. Your material is still here.',
        });
      if (!check.installed)
        return setAnalysis({
          status: 'error',
          message: `The model “${settings.model.trim()}” is not installed. Run “ollama pull ${settings.model.trim()}”, then try again, or use outline mode (no AI) now. Your material is still here.`,
        });
      const result = await analyzeMaterial({
        text: material.text,
        goal: settings.goal,
        provider: runtime.provider,
        signal: controller.signal,
        onProgress: (progress) => setAnalysis({ status: 'running', progress }),
        ...(check.info?.digest ? { modelDigest: check.info.digest } : {}),
      });
      if (result.report.verifiedTopics === 0) {
        dispatch({ type: 'analyzed', topics: result.topics, report: result.report });
        return setAnalysis({ status: 'notopics', mode: 'model' });
      }
      focusNext.current = true;
      dispatch({
        type: 'analyzed',
        topics: applyKnownTopics(result.topics, settings.knownTopics),
        report: result.report,
      });
      setAnalysis({ status: 'idle' });
    } catch (error) {
      const message = isAiError(error)
        ? error.message
        : error instanceof RangeError
          ? error.message
          : 'Something went wrong while analyzing. Your material is still here.';
      setAnalysis(
        isAiError(error) && error.code === 'ABORTED'
          ? { status: 'idle' }
          : {
              status: 'error',
              message:
                `${message} Your material is still here. You can also use outline mode (no AI).`.replace(
                  /(Your material is still here\.) Your material is still here\./,
                  '$1',
                ),
            },
      );
    } finally {
      abort.current = null;
    }
  }

  function outline() {
    const problem = validateMaterial(material.text);
    if (problem) return setMaterialError(problem);
    setMaterialError(null);
    if (settingsErrors.length > 0)
      return setAnalysis({ status: 'error', message: settingsErrors[0]! });
    try {
      const result = outlineMaterial(material.text);
      if (result.report.verifiedTopics === 0) {
        return setAnalysis({ status: 'notopics', mode: 'outline' });
      }
      focusNext.current = true;
      dispatch({
        type: 'analyzed',
        topics: applyKnownTopics(result.topics, settings.knownTopics),
        report: result.report,
      });
      setAnalysis({ status: 'idle' });
    } catch (error) {
      setAnalysis({
        status: 'error',
        message:
          error instanceof RangeError
            ? error.message
            : 'Outline mode could not read this material. Your material is still here.',
      });
    }
  }

  function useSample() {
    if (
      state.topics.length > 0 &&
      !window.confirm('Replace your current topics and progress with the sample?')
    )
      return;
    const sample = loadSample(today);
    focusNext.current = true;
    setMaterialError(null);
    setAnalysis({ status: 'idle' });
    dispatch({
      type: 'sample',
      material: sample.material,
      settings: sample.settings,
      topics: sample.topics,
      report: sample.report,
    });
  }

  async function onFile(file: File) {
    setMaterialError(null);
    setPdfBusy(true);
    try {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf')
        throw new PdfError('NOT_PDF');
      const extracted = await extractPdfText(await file.arrayBuffer(), await pdfLoader());
      dispatch({
        type: 'material',
        material: {
          text: extracted.text,
          source: 'pdf',
          fileName: file.name,
          pageCount: extracted.pageCount,
          lowTextPages: extracted.lowTextPages,
        },
      });
    } catch (error) {
      setMaterialError(
        error instanceof PdfError
          ? error.message
          : 'That PDF could not be read. Paste the text instead.',
      );
    } finally {
      setPdfBusy(false);
    }
  }

  const markDone = (t: PlanTask) => dispatch({ type: 'complete', task: t, today });
  const markdown = () =>
    exportMarkdown({
      goal: settings.goal,
      settings: planSettings,
      topics,
      plan: plan!,
      progress,
      report: state.report,
    });

  function download() {
    try {
      const url = URL.createObjectURL(new Blob([markdown()], { type: 'text/markdown' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'study-plan.md';
      a.click();
      URL.revokeObjectURL(url);
      setExportNote('Downloaded study-plan.md.');
    } catch {
      setExportNote('Download failed. Use “Copy Markdown” instead.');
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown());
      setExportNote('Copied to the clipboard.');
    } catch {
      setExportNote('Copy was blocked by the browser. Use “Download” instead.');
    }
  }
  function startOver(skipConfirm = false) {
    if (
      !skipConfirm &&
      !window.confirm('Delete your material, topics and progress from this browser?')
    )
      return;
    abort.current?.abort();
    clearState(storage);
    dispatch({ type: 'reset', today });
    setAnalysis({ status: 'idle' });
    setMaterialError(null);
    setExportNote('');
  }

  const hasTopics = topics.length > 0;
  const running = analysis.status === 'running';
  const activeTopics = topics.filter(isActive);
  const totalMinutes = activeTopics.reduce((s, t) => s + t.minutes, 0);
  const doneMinutes = activeTopics.reduce(
    (s, t) => s + Math.min(t.minutes, progress[t.id]?.studiedMinutes ?? 0),
    0,
  );
  const held = topics.filter((t) => t.status === 'unverified');
  const setModel = (model: string) => dispatch({ type: 'settings', patch: { model } });
  const onText = (text: string) => {
    setMaterialError(null);
    dispatch({ type: 'material', material: { text, source: 'paste' } });
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg className="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <circle cx="16" cy="16" r="15" />
            <path d="M9 17c2 4 12 4 14 0" />
            <circle cx="12" cy="13" r="1.6" />
            <circle cx="20" cy="13" r="1.6" />
          </svg>
          <div>
            <h1>PrepFlow Sloth</h1>
            <p className="tagline">Give it your syllabus. Get your next step.</p>
          </div>
        </div>
        <ModelStatus state={modelState} model={settings.model} onRecheck={recheck} />
      </header>
      <main id="main">
        {!storageOk && (
          <p className="card note" role="status">
            This browser would not save your work, so it will be lost when you close the page.
            Export it before leaving.
          </p>
        )}

        {!hasTopics && (
          <>
            <section className="card intro" aria-labelledby="how-h">
              <h2 id="how-h">How it works</h2>
              <ol>
                <li>
                  Paste your syllabus or notes (or upload a text PDF) and set your exam date and
                  daily time.
                </li>
                <li>
                  A local Gemma model finds the topics. Each one must point to a passage in{' '}
                  <em>your</em> material, or it is held back.
                </li>
                <li>
                  Plain code turns them into a plan that fits your time, shows what does not fit,
                  and schedules revision.
                </li>
              </ol>
              <p className="hint">
                Your material is sent only to your own Ollama runtime (by default on this computer)
                and is saved in this browser only. It is never sent to a hosted AI service by this
                app.
              </p>
              <div className="sample-cta">
                <p>
                  <strong>Just looking?</strong> Load a sample syllabus and explore the whole app
                  without installing a model. The sample’s topics are written by hand and labelled
                  as such.
                </p>
                <button type="button" onClick={useSample}>
                  Try the sample (no model needed)
                </button>
              </div>
            </section>
            <section className="card" aria-labelledby="setup-h">
              <h2 id="setup-h">1. Your exam</h2>
              <SettingsForm
                settings={settings}
                errors={settingsErrors}
                onChange={(patch) => dispatch({ type: 'settings', patch })}
                today={today}
              />
            </section>
            <section className="card" aria-labelledby="mat-h">
              <h2 id="mat-h">2. Your material</h2>
              <MaterialPanel
                material={material}
                error={materialError}
                busy={running || pdfBusy}
                onText={onText}
                onFile={onFile}
              />
              {pdfBusy && <p role="status">Reading the PDF…</p>}
            </section>
            <section className="card" aria-labelledby="go-h">
              <h2 id="go-h">3. Find my topics</h2>
              <AnalyzeControls
                variant="first"
                model={settings.model}
                modelState={modelState}
                analysis={analysis}
                running={running}
                busy={pdfBusy}
                onModel={setModel}
                onAnalyze={() => void analyze()}
                onOutline={outline}
                onCancel={() => abort.current?.abort()}
              />
            </section>
          </>
        )}

        {hasTopics && <ProvenanceBanner report={state.report} onClear={() => startOver(true)} />}

        {hasTopics && plan && (
          <>
            <NextTaskCard
              task={task}
              topics={topics}
              plan={plan}
              settings={planSettings}
              today={today}
              progress={progress}
              onDone={markDone}
              onUndo={() => dispatch({ type: 'undo' })}
              canUndo={state.history.length > 0}
              headingRef={nextHeading}
            />
            <ProgressCard
              plan={plan}
              doneMinutes={doneMinutes}
              totalMinutes={totalMinutes}
              daysToExam={Math.max(0, daysBetween(today, settings.examDate))}
              minutesLabel={minutesText(plan.stats.requiredMinutes)}
            />
            <FitBanner
              plan={plan}
              settings={planSettings}
              topics={topics}
              suggestion={suggestion}
              onUseMinutes={(m) => dispatch({ type: 'settings', patch: { minutesPerDay: m } })}
            />
            <ScheduleSection plan={plan} topics={topics} today={today} onDone={markDone} />
          </>
        )}
        {hasTopics && !plan && (
          <section className="card warn" role="alert">
            <h2>Fix the plan settings</h2>
            <ul>
              {settingsErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </section>
        )}

        {hasTopics && (
          <>
            <section className="card" aria-labelledby="topics-h">
              <h2 id="topics-h">Topics ({topics.length})</h2>
              {state.report && (
                <p className="hint">
                  {state.report.verifiedTopics} found in your material,{' '}
                  {state.report.unverifiedTopics} held back
                  {state.report.duplicatesMerged
                    ? `, ${state.report.duplicatesMerged} duplicate(s) merged`
                    : ''}
                  {state.report.weakSupport ? `, ${state.report.weakSupport} to double-check` : ''}.{' '}
                  {state.report.mode === 'sample'
                    ? 'Source: hand-written sample (not a model).'
                    : state.report.mode === 'outline'
                      ? 'Source: outline rules (not a model).'
                      : `Model: ${state.report.model}, ${(state.report.durationMs / 1000).toFixed(0)} s.`}
                  {state.report.chunkFailures.length > 0
                    ? ` ${state.report.chunkFailures.length} part(s) of your material could not be analyzed.`
                    : ''}
                </p>
              )}
              {topics
                .filter((t) => t.status === 'verified')
                .map((t) => (
                  <TopicCard
                    key={t.id}
                    topic={t}
                    topics={topics}
                    progress={progress}
                    settings={planSettings}
                    plan={plan}
                    onPatch={(patch) => dispatch({ type: 'topic', id: t.id, patch })}
                  />
                ))}
              {held.length > 0 && (
                <h3 className="subhead">
                  Held back: no matching passage in your material ({held.length})
                </h3>
              )}
              {held.map((t) => (
                <TopicCard
                  key={t.id}
                  topic={t}
                  topics={topics}
                  progress={progress}
                  settings={planSettings}
                  plan={plan}
                  onPatch={(patch) => dispatch({ type: 'topic', id: t.id, patch })}
                />
              ))}
            </section>
            <section className="card" aria-labelledby="settings-h">
              <details>
                <summary id="settings-h">Plan settings and material</summary>
                <SettingsForm
                  settings={settings}
                  errors={settingsErrors}
                  onChange={(patch) => dispatch({ type: 'settings', patch })}
                  today={today}
                />
                <MaterialPanel
                  material={material}
                  error={materialError}
                  busy={running || pdfBusy}
                  onText={onText}
                  onFile={onFile}
                />
                <p className="hint">
                  Changing the material or model does nothing until you analyze again. Your progress
                  is kept for topics with the same name.
                </p>
                <AnalyzeControls
                  variant="again"
                  model={settings.model}
                  modelState={modelState}
                  analysis={analysis}
                  running={running}
                  busy={pdfBusy}
                  onModel={setModel}
                  onAnalyze={() => void analyze()}
                  onOutline={outline}
                  onCancel={() => abort.current?.abort()}
                />
              </details>
            </section>
            <section className="card" aria-labelledby="export-h">
              <h2 id="export-h">Export and your data</h2>
              <div className="actions">
                <button type="button" onClick={download} disabled={!plan}>
                  Download Markdown
                </button>
                <button type="button" onClick={() => void copy()} disabled={!plan}>
                  Copy Markdown
                </button>
                <button type="button" className="danger" onClick={() => startOver()}>
                  Start over
                </button>
              </div>
              <p className="hint" aria-live="polite">
                {exportNote}
              </p>
              <details className="data-note">
                <summary>What is stored, and where</summary>
                <ul>
                  <li>
                    In this browser only (<code>localStorage</code>, key{' '}
                    <code>prepflow-sloth:v1</code>): your material text, topics, settings and
                    progress. Nothing is synced or backed up.
                  </li>
                  <li>
                    An uploaded PDF itself is never stored; only the text pulled out of it is, as
                    part of your material.
                  </li>
                  <li>
                    Analysis sends your material, in parts, only to the Ollama runtime this page is
                    configured to use (normally on this computer). There is no analytics.
                  </li>
                  <li>
                    “Start over” deletes everything listed above from this browser. It cannot undo
                    what you already exported.
                  </li>
                </ul>
              </details>
            </section>
          </>
        )}
      </main>
      <footer>
        <p>
          PrepFlow Sloth is an open-source study planner. Topic suggestions come from a local
          open-weight Gemma model and can be wrong: check the source passages. Estimates are
          guesses, and priority is a heuristic.
        </p>
      </footer>
    </div>
  );
}

export { initialState };
