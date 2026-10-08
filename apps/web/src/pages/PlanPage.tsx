import type {
  FitStatus,
  GetPlanResponse,
  StudyPlanResponse,
  TopicPlanInsight,
} from '@prepflow/shared';
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api } from '../api/endpoints';
import { LevelBadge, ProgressBar, Stat, TIER_LABEL, TierBadge } from '../components/PlanBits';
import { Alert, Button, Card, LinkButton } from '../components/ui';
import { formatDay, formatMinutes, localIsoDate, plural } from '../lib/format';
import { messageOf, useLoad } from '../lib/useLoad';
import { clearExamId, getExamId } from '../workspace';

const FIT_STYLE: Record<
  FitStatus,
  { label: string; kind: 'success' | 'info' | 'warning' | 'error' }
> = {
  GOOD: { label: 'Good', kind: 'success' },
  TIGHT: { label: 'Tight', kind: 'warning' },
  OVER_CAPACITY: { label: 'Over capacity', kind: 'error' },
  NO_CAPACITY: { label: 'No time left', kind: 'error' },
};

export function PlanPage() {
  const examId = getExamId();
  if (!examId) return <Navigate to="/setup" replace />;
  return <PlanScreen examId={examId} />;
}

function PlanScreen({ examId }: { examId: string }) {
  const date = localIsoDate();
  const { state, reload, setState } = useLoad(() => api.getPlan(examId, date));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: 'error' | 'info' | 'success';
    message: string;
  } | null>(null);

  if (state.kind === 'loading') return <p className="text-sm text-slate-600">Loading…</p>;
  if (state.kind === 'error') {
    if (state.code === 'EXAM_NOT_FOUND') {
      clearExamId();
      return <Navigate to="/setup" replace />;
    }
    return (
      <Card title="We couldn’t load your plan">
        <p className="mb-4 text-sm text-slate-600">{state.message}</p>
        <Button onClick={() => void reload()}>Try again</Button>
      </Card>
    );
  }

  const data: GetPlanResponse = state.data;

  async function run(
    label: string,
    action: () => Promise<{ plan: StudyPlanResponse }>,
    done: string,
  ) {
    setBusy(label);
    setNotice(null);
    try {
      const { plan } = await action();
      setState({ kind: 'ready', data: { ...data, plan } });
      await reload();
      setNotice({ kind: 'success', message: done });
    } catch (error) {
      setNotice({ kind: 'error', message: messageOf(error) });
    } finally {
      setBusy(null);
    }
  }

  const generate = () =>
    run('generate', () => api.generatePlan(examId, date), 'Your study plan is ready.');
  const rebalance = (mode: 'REPLAN' | 'RECOVER', includeSkipped = false) =>
    run(
      mode,
      () => api.rebalance(examId, { mode, includeSkipped, planDate: date }),
      mode === 'RECOVER'
        ? 'Missed tasks were moved into your spare time.'
        : 'The remaining plan was rebalanced. Finished work was kept.',
    );

  if (!data.plan) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your study plan</h1>
          <p className="mt-1 text-sm text-slate-600">
            PrepFlow combines your exam date, daily time and the analyzed topics into a schedule it
            can explain. The AI classifies your material; the plan itself is calculated by fixed
            rules, so the same inputs always give the same plan.
          </p>
        </div>
        {data.staleReason && <Alert kind="warning">{data.staleReason}</Alert>}
        {notice && <Alert kind={notice.kind}>{notice.message}</Alert>}
        <Card title="Build your plan">
          <p className="mb-4 text-sm text-slate-600">
            You need an analysis first.{' '}
            <Link to="/analysis" className="font-medium text-indigo-700 underline">
              Go to analysis
            </Link>
          </p>
          <Button onClick={() => void generate()} busy={busy === 'generate'}>
            {busy === 'generate' ? 'Planning…' : 'Generate study plan'}
          </Button>
        </Card>
      </div>
    );
  }

  const plan = data.plan;
  const { fit } = plan.summary;
  const style = FIT_STYLE[fit.status];
  const overdue = plan.progress.overdueTasks;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your study plan</h1>
          <p className="text-sm text-slate-600">
            Version {plan.version} · made {formatDay(plan.planDate)}
          </p>
        </div>
        <LinkButton to="/today">Open Today</LinkButton>
      </div>

      {notice && <Alert kind={notice.kind}>{notice.message}</Alert>}
      {plan.settingsChanged && (
        <Alert kind="info">
          Your exam settings changed after this plan was made. Rebalance to apply them.
        </Alert>
      )}

      <Card>
        <p className="text-sm font-medium text-slate-700">
          Exam in {plural(plan.daysUntilExam, 'day')}
        </p>
        <p className="mt-1 text-lg font-semibold">
          Plan fit: <span aria-label={`Plan fit ${style.label}`}>{style.label.toUpperCase()}</span>
        </p>
        <div className="mt-3">
          <Alert kind={style.kind}>{fit.headline}</Alert>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Required"
            value={formatMinutes(fit.requiredStudyMinutes)}
            hint="new material"
          />
          <Stat
            label="Available"
            value={formatMinutes(fit.totalMinutes)}
            hint={plural(fit.studyDays, 'study day')}
          />
          <Stat label="Buffer" value={formatMinutes(fit.bufferMinutes)} hint="kept free" />
          <Stat
            label="Revision"
            value={formatMinutes(fit.revisionScheduledMinutes)}
            hint={plural(plan.summary.revision.scheduled, 'session')}
          />
        </dl>
        {fit.capacityGapMinutes > 0 && (
          <p className="mt-4 text-sm text-red-800">
            You have {formatMinutes(fit.capacityGapMinutes)} less capacity than the material needs.
            PrepFlow protected the highest-priority topics and deferred lower-priority material.
          </p>
        )}
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-slate-600">
            <span>Completed</span>
            <span>{plan.progress.completionPct}%</span>
          </div>
          <ProgressBar
            value={plan.progress.completedMinutes}
            max={plan.progress.plannedMinutes}
            label="Plan completion"
            tone="emerald"
          />
        </div>
      </Card>

      {plan.summary.warnings.length > 0 && (
        <section aria-label="Warnings" className="space-y-2">
          {plan.summary.warnings.map((w, index) => (
            <Alert
              key={`${w.code}-${index}`}
              kind={
                w.code === 'OVER_CAPACITY' || w.code === 'PLAN_OVERLOADED' ? 'error' : 'warning'
              }
            >
              {w.message}
            </Alert>
          ))}
        </section>
      )}

      {overdue > 0 && (
        <Card title="Missed tasks">
          <p className="text-sm text-slate-700">
            {plural(overdue, 'task')} ({formatMinutes(plan.progress.overdueMinutes)}) from earlier
            days {overdue === 1 ? 'is' : 'are'} still open. You can move{' '}
            {overdue === 1 ? 'it' : 'them'} into spare time, or re-plan everything that is left.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void rebalance('RECOVER')}
              busy={busy === 'RECOVER'}
            >
              Move missed tasks
            </Button>
            <Button onClick={() => void rebalance('REPLAN')} busy={busy === 'REPLAN'}>
              Re-plan the rest
            </Button>
          </div>
          {plan.summary.recovery && plan.summary.recovery.overloadMinutes > 0 && (
            <p className="mt-2 text-sm text-red-800">
              Not everything fit: the plan is overloaded by{' '}
              {formatMinutes(plan.summary.recovery.overloadMinutes)}.
            </p>
          )}
        </Card>
      )}

      <Tiers plan={plan} />
      <Topics topics={plan.summary.topics} />
      <Days plan={plan} />

      <Card title="Change of plans?">
        <p className="mb-3 text-sm text-slate-600">
          Rebalancing re-plans only what is not finished. Completed and skipped tasks stay exactly
          as they are, and the previous version is kept in the history below.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => void rebalance('REPLAN')}
            busy={busy === 'REPLAN'}
          >
            Rebalance remaining plan
          </Button>
          {plan.progress.tasksSkipped > 0 && (
            <Button
              variant="secondary"
              onClick={() => void rebalance('REPLAN', true)}
              busy={busy === 'REPLAN'}
            >
              Rebalance and bring back skipped study
            </Button>
          )}
          <LinkButton to="/setup" variant="secondary">
            Edit exam settings
          </LinkButton>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-indigo-700">
            Plan history ({data.versions.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {data.versions.map((v) => (
              <li key={v.id}>
                v{v.version} ·{' '}
                {v.trigger === 'GENERATE'
                  ? 'generated'
                  : v.trigger === 'RECOVER_MISSED'
                    ? 'missed tasks moved'
                    : 'rebalanced'}{' '}
                on {formatDay(v.planDate)} ·{' '}
                {v.status === 'ACTIVE'
                  ? 'current'
                  : `archived (${(v.archivedReason ?? '').toLowerCase()})`}
              </li>
            ))}
          </ul>
        </details>
      </Card>
    </div>
  );
}

function Tiers({ plan }: { plan: StudyPlanResponse }) {
  const tiers = plan.summary.tiers;
  const rows = (['MUST', 'SHOULD', 'IF_TIME', 'DEFER'] as const).filter(
    (t) => (tiers[t]?.topics ?? 0) > 0,
  );
  if (rows.length === 0) return null;
  return (
    <Card title="What is protected">
      <ul className="space-y-1 text-sm">
        {rows.map((tier) => (
          <li key={tier} className="flex justify-between gap-3">
            <span>
              <strong className="font-medium">{TIER_LABEL[tier]}</strong>{' '}
              <span className="text-slate-600">· {plural(tiers[tier]?.topics ?? 0, 'topic')}</span>
            </span>
            <span className="text-slate-600">{formatMinutes(tiers[tier]?.minutes ?? 0)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Topics({ topics }: { topics: TopicPlanInsight[] }) {
  const high = topics.filter((t) => t.level === 'HIGH').length;
  return (
    <Card title="Topics by priority">
      <p className="mb-2 text-sm text-slate-600">
        {plural(high, 'high-priority topic')}. Scores are calculated from the AI’s classification,
        your weak topics and the prerequisite order, never written by the AI.
      </p>
      <ol className="divide-y divide-slate-100">
        {topics.map((t) => (
          <li key={t.topicId} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/topics/${t.topicId}`}
                className="text-sm font-semibold text-indigo-800 underline"
              >
                {t.name}
              </Link>
              <LevelBadge level={t.level} />
              <TierBadge tier={t.tier} />
              <span className="text-xs text-slate-500">
                {t.subjectName} · ~{formatMinutes(t.estimatedMinutes)} · score {t.score}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-700">{t.placement}</p>
            {t.reasons.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs font-medium text-indigo-700">
                  Why this priority?
                </summary>
                <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                  {t.reasons.map((r) => (
                    <li key={r.code}>{r.text}</li>
                  ))}
                  {t.requiredMinutes > 0 && (
                    <li>It needs about {formatMinutes(t.requiredMinutes)} of study.</li>
                  )}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Days({ plan }: { plan: StudyPlanResponse }) {
  const days = plan.days.filter((d) => d.taskCount > 0);
  if (days.length === 0) return null;
  return (
    <Card title="Daily workload">
      <ul className="space-y-2">
        {days.map((d) => (
          <li key={d.date}>
            <div className="flex justify-between text-sm">
              <span>{formatDay(d.date)}</span>
              <span className="text-slate-600">
                {formatMinutes(d.plannedMinutes)}
                {d.capacityMinutes > 0 ? ` of ${formatMinutes(d.capacityMinutes)}` : ''}
                {d.revisionMinutes > 0 ? ` · ${formatMinutes(d.revisionMinutes)} revision` : ''}
              </span>
            </div>
            <ProgressBar
              value={d.plannedMinutes}
              max={d.capacityMinutes || d.plannedMinutes}
              label={`Workload on ${formatDay(d.date)}`}
              tone={d.plannedMinutes > d.capacityMinutes ? 'amber' : 'indigo'}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
