import type { StudyTaskView } from '@prepflow/shared';
import { Link } from 'react-router';
import { formatDay, formatMinutes, formatPageRef } from '../lib/format';
import { LevelBadge, STATUS_LABEL, TypeBadge } from './PlanBits';
import { Button } from './ui';

/** One task with its explanation and (optionally) the actions to change its state. */
export function TaskRow({
  task,
  busy,
  onAction,
  showDate = false,
}: {
  task: StudyTaskView;
  busy?: boolean;
  onAction?: (action: 'start' | 'complete' | 'skip' | 'uncomplete', task: StudyTaskView) => void;
  showDate?: boolean;
}) {
  const open = task.status === 'PENDING' || task.status === 'IN_PROGRESS';
  const part = task.partCount ? ` (part ${task.partIndex} of ${task.partCount})` : '';
  return (
    <li className="py-4" data-status={task.status}>
      <div className="flex flex-wrap items-center gap-2">
        {task.topicId ? (
          <Link
            to={`/topics/${task.topicId}`}
            className="text-sm font-semibold text-indigo-800 underline"
          >
            {task.topicName}
          </Link>
        ) : (
          <span className="text-sm font-semibold">{task.topicName}</span>
        )}
        <span className="text-sm text-slate-600">{part}</span>
        <TypeBadge type={task.type} index={task.revisionIndex} />
        <LevelBadge level={task.level} />
        {task.overdue && (
          <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs text-red-800">
            Overdue
          </span>
        )}
        {!open && (
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700">
            {STATUS_LABEL[task.status]}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-700">
        {formatMinutes(task.minutes)}
        {showDate && ` · ${formatDay(task.date)}`}
        {task.originalDate && ` · moved from ${formatDay(task.originalDate)}`}
        {task.subjectName && ` · ${task.subjectName}`}
        {task.evidence?.page != null &&
          ` · ${formatPageRef(task.evidence.page, task.evidence.pageEnd)}`}
      </p>
      {task.reasons.length > 0 && (
        <p className="mt-1 text-xs text-slate-600">Why: {task.reasons.join(' · ')}</p>
      )}
      {task.prerequisites.length > 0 && task.type === 'STUDY' && (
        <p className="mt-1 text-xs text-slate-500">Builds on: {task.prerequisites.join(', ')}</p>
      )}
      {open && onAction && (
        <div className="mt-2 flex flex-wrap gap-2">
          {task.status === 'PENDING' && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => onAction('start', task)}
              aria-label={`Start ${task.topicName}`}
            >
              Start
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={() => onAction('complete', task)}
            aria-label={`Complete ${task.topicName}`}
          >
            Complete
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onAction('skip', task)}
            aria-label={`Skip ${task.topicName}`}
          >
            Skip
          </Button>
        </div>
      )}
      {task.status === 'COMPLETED' && onAction && (
        <div className="mt-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onAction('uncomplete', task)}
            aria-label={`Undo completion of ${task.topicName}`}
          >
            Undo completion
          </Button>
        </div>
      )}
    </li>
  );
}
