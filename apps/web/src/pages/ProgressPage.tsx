import { Navigate, Link } from 'react-router';
import { api } from '../api/endpoints';
import { ProgressBar, Stat, STATUS_LABEL } from '../components/PlanBits';
import { Button, Card, LinkButton } from '../components/ui';
import { formatMinutes, localIsoDate, plural, titleCase } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { getExamId } from '../workspace';

export function ProgressPage() {
  const examId = getExamId();
  if (!examId) return <Navigate to="/setup" replace />;
  return <ProgressScreen examId={examId} />;
}

function ProgressScreen({ examId }: { examId: string }) {
  const { state, reload } = useLoad(() => api.getPlan(examId, localIsoDate()));
  if (state.kind === 'loading') return <p className="text-sm text-slate-600">Loading…</p>;
  if (state.kind === 'error')
    return (
      <Card title="We couldn’t load your progress">
        <p className="mb-4 text-sm text-slate-600">{state.message}</p>
        <Button onClick={() => void reload()}>Try again</Button>
      </Card>
    );
  const plan = state.data.plan;
  if (!plan)
    return (
      <Card title="Progress">
        <p className="mb-4 text-sm text-slate-600">Progress appears once you have a study plan.</p>
        <LinkButton to="/plan">Build your plan</LinkButton>
      </Card>
    );
  const p = plan.progress;
  const subjectByTopic = new Map(
    plan.summary.topics.map((topic) => [topic.topicId, topic.subjectName]),
  );
  const bySubject = new Map<string, typeof plan.topicProgress>();
  for (const topic of plan.topicProgress) {
    const subjectName = subjectByTopic.get(topic.topicId) ?? 'Other topics';
    bySubject.set(subjectName, [...(bySubject.get(subjectName) ?? []), topic]);
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
      <Card>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Completed"
            value={formatMinutes(p.completedMinutes)}
            hint={`of ${formatMinutes(p.plannedMinutes)} planned`}
          />
          <Stat
            label="Remaining"
            value={formatMinutes(p.remainingMinutes)}
            hint={plural(p.tasksRemaining, 'task')}
          />
          <Stat
            label="Overdue"
            value={String(p.overdueTasks)}
            hint={formatMinutes(p.overdueMinutes)}
          />
          <Stat
            label="Revision"
            value={`${p.revisionCompleted}/${p.revisionTotal}`}
            hint="sessions done"
          />
        </dl>
        <div className="mt-4">
          <ProgressBar
            value={p.completedMinutes}
            max={p.plannedMinutes}
            label="Overall completion"
            tone="emerald"
          />
          <p className="mt-1 text-xs text-slate-600">
            {p.completionPct}% of planned time · {p.topicsCompleted} of {p.topicsTotal} topics
            studied
            {p.topicsDeferred > 0 ? ` · ${p.topicsDeferred} deferred` : ''} · {p.tasksSkipped}{' '}
            skipped
          </p>
        </div>
      </Card>
      {bySubject.size > 0 && (
        <Card title="By subject">
          <ul className="divide-y divide-slate-100">
            {[...bySubject.entries()].map(([subject, topics]) => {
              const planned = topics.reduce((sum, topic) => sum + topic.studyMinutesPlanned, 0);
              const completed = topics.reduce((sum, topic) => sum + topic.studyMinutesCompleted, 0);
              const done = topics.filter((topic) => topic.status === 'COMPLETED').length;
              return (
                <li key={subject} className="py-3">
                  <div className="mb-1 flex flex-wrap justify-between gap-2 text-sm">
                    <span className="font-medium">{subject}</span>
                    <span className="text-slate-600">
                      {done}/{topics.length} topics · {formatMinutes(completed)} of{' '}
                      {formatMinutes(planned)}
                    </span>
                  </div>
                  <ProgressBar
                    value={completed}
                    max={planned}
                    label={`${subject} progress`}
                    tone="emerald"
                  />
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Card title="Topics">
        <ul className="divide-y divide-slate-100">
          {plan.topicProgress.map((t) => (
            <li key={t.topicId} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  to={`/topics/${t.topicId}`}
                  className="text-sm font-medium text-indigo-800 underline"
                >
                  {t.name}
                </Link>
                <span className="text-xs text-slate-600">
                  {titleCase(t.status)} · revision {t.revisionsCompleted}/{t.revisionsPlanned}
                </span>
              </div>
              <div className="mt-1">
                <ProgressBar
                  value={t.studyMinutesCompleted}
                  max={t.studyMinutesPlanned}
                  label={`${t.name} study progress`}
                  tone="emerald"
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-slate-500">
        Statuses: {Object.values(STATUS_LABEL).join(', ')}. Progress is arithmetic on your tasks; no
        AI is involved.
      </p>
    </div>
  );
}
