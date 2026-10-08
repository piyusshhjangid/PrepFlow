import type { StudyTaskView, TodayResponse } from '@prepflow/shared';
import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { api } from '../api/endpoints';
import { ProgressBar, Stat } from '../components/PlanBits';
import { TaskRow } from '../components/TaskRow';
import { Alert, Button, Card, LinkButton } from '../components/ui';
import { formatDay, formatMinutes, localIsoDate, plural } from '../lib/format';
import { messageOf, useLoad } from '../lib/useLoad';
import { clearExamId, getExamId } from '../workspace';

export function TodayPage() {
  const examId = getExamId();
  if (!examId) return <Navigate to="/setup" replace />;
  return <TodayScreen examId={examId} />;
}

function TodayScreen({ examId }: { examId: string }) {
  const date = localIsoDate();
  const { state, reload } = useLoad(() => api.getToday(examId, date));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (state.kind === 'loading') return <p className="text-sm text-slate-600">Loading…</p>;
  if (state.kind === 'error') {
    if (state.code === 'EXAM_NOT_FOUND') {
      clearExamId();
      return <Navigate to="/setup" replace />;
    }
    return (
      <Card title="We couldn’t load today’s plan">
        <p className="mb-4 text-sm text-slate-600">{state.message}</p>
        <Button onClick={() => void reload()}>Try again</Button>
      </Card>
    );
  }
  const today: TodayResponse = state.data;

  async function act(action: 'start' | 'complete' | 'skip' | 'uncomplete', task: StudyTaskView) {
    setBusyId(task.id);
    setError(null);
    try {
      await api.taskAction(task.id, action, date);
      await reload(); // the server owns the numbers; always show what it says
    } catch (e) {
      setError(messageOf(e));
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  if (!today.hasPlan) {
    return (
      <Card title="Today">
        <p className="mb-4 text-sm text-slate-600">You don’t have an active study plan yet.</p>
        <LinkButton to="/plan">Build your plan</LinkButton>
      </Card>
    );
  }

  const open = today.tasks.filter((t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS');
  const finished = today.tasks.filter((t) => t.status === 'COMPLETED' || t.status === 'SKIPPED');
  const allDone = today.tasks.length > 0 && open.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today’s study plan</h1>
        <p className="text-sm text-slate-600">
          {formatDay(today.date)} · exam in {plural(today.daysUntilExam, 'day')}
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <Card>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Available"
            value={today.isStudyDay ? formatMinutes(today.capacityMinutes) : 'Day off'}
          />
          <Stat label="Planned" value={formatMinutes(today.plannedMinutes)} />
          <Stat label="Done" value={formatMinutes(today.completedMinutes)} />
          <Stat label="Remaining" value={formatMinutes(today.remainingMinutes)} />
        </dl>
        <div className="mt-4">
          <ProgressBar
            value={today.completedMinutes}
            max={today.plannedMinutes}
            label="Today’s progress"
            tone="emerald"
          />
        </div>
        {today.urgentRevision > 0 && (
          <p className="mt-3 text-sm text-violet-800">
            {plural(today.urgentRevision, 'revision session')} due now or overdue.
          </p>
        )}
      </Card>

      {today.overdue.length > 0 && (
        <Alert kind="warning">
          {plural(today.overdue.length, 'task')} ({formatMinutes(today.overdueMinutes)}) from
          earlier days
          {today.overdue.length === 1 ? ' is' : ' are'} still open.{' '}
          <Link to="/plan" className="font-medium underline">
            Move or re-plan them
          </Link>
          .
        </Alert>
      )}

      {allDone && <Alert kind="success">Everything planned for today is done.</Alert>}
      {today.tasks.length === 0 && (
        <Alert kind="info">
          {today.isStudyDay
            ? 'Nothing is scheduled for today.'
            : 'Today is a day off in your schedule.'}
        </Alert>
      )}

      {open.length > 0 && (
        <Card title="To do">
          <ol className="divide-y divide-slate-100">
            {open.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                busy={busyId === t.id}
                onAction={(a, task) => void act(a, task)}
              />
            ))}
          </ol>
        </Card>
      )}

      {today.overdue.length > 0 && (
        <Card title="Overdue">
          <ol className="divide-y divide-slate-100">
            {today.overdue.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                showDate
                busy={busyId === t.id}
                onAction={(a, task) => void act(a, task)}
              />
            ))}
          </ol>
        </Card>
      )}

      {finished.length > 0 && (
        <Card title="Finished today">
          <ol className="divide-y divide-slate-100">
            {finished.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                busy={busyId === t.id}
                onAction={(a, task) => void act(a, task)}
              />
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
