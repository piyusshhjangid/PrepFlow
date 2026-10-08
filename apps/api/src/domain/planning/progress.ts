import type {
  DaySummary,
  PlanProgress,
  TaskStatus,
  TaskType,
  TopicProgress,
} from '@prepflow/shared';
import type { DayCapacity } from './types.js';

/** Progress is arithmetic on task rows. No model is involved. */

export interface ProgressTask {
  topicId: string | null;
  type: TaskType;
  status: TaskStatus;
  date: string;
  minutes: number;
}

const OPEN = new Set<TaskStatus>(['PENDING', 'IN_PROGRESS']);
const sum = (tasks: readonly ProgressTask[]) => tasks.reduce((acc, t) => acc + t.minutes, 0);

export function isOpen(status: TaskStatus): boolean {
  return OPEN.has(status);
}

export function computeProgress(
  tasks: readonly ProgressTask[],
  topics: readonly { id: string; name: string; deferred: boolean }[],
  today: string,
): { progress: PlanProgress; topics: TopicProgress[] } {
  const completed = tasks.filter((t) => t.status === 'COMPLETED');
  const skipped = tasks.filter((t) => t.status === 'SKIPPED');
  const inProgress = tasks.filter((t) => t.status === 'IN_PROGRESS');
  const open = tasks.filter((t) => isOpen(t.status));
  const overdue = open.filter((t) => t.date < today);
  const revision = tasks.filter((t) => t.type === 'REVISION');

  const byTopic = new Map<string, ProgressTask[]>();
  for (const t of tasks) {
    if (t.topicId === null) continue;
    const list = byTopic.get(t.topicId) ?? [];
    list.push(t);
    byTopic.set(t.topicId, list);
  }
  const topicProgress: TopicProgress[] = topics.map((topic) => {
    const own = byTopic.get(topic.id) ?? [];
    const study = own.filter((t) => t.type === 'STUDY');
    const rev = own.filter((t) => t.type === 'REVISION');
    const studyDone = study.filter((t) => t.status === 'COMPLETED');
    const started = study.some((t) => t.status === 'COMPLETED' || t.status === 'IN_PROGRESS');
    let status: TopicProgress['status'];
    if (study.length === 0) status = topic.deferred ? 'DEFERRED' : 'COMPLETED';
    else if (studyDone.length === study.length) status = 'COMPLETED';
    else status = started ? 'IN_PROGRESS' : 'NOT_STARTED';
    return {
      topicId: topic.id,
      name: topic.name,
      status,
      studyMinutesPlanned: sum(study),
      studyMinutesCompleted: sum(studyDone),
      revisionsPlanned: rev.length,
      revisionsCompleted: rev.filter((t) => t.status === 'COMPLETED').length,
    };
  });

  const plannedMinutes = sum(tasks);
  const completedMinutes = sum(completed);
  return {
    progress: {
      tasksTotal: tasks.length,
      tasksCompleted: completed.length,
      tasksSkipped: skipped.length,
      tasksInProgress: inProgress.length,
      tasksRemaining: open.length,
      plannedMinutes,
      completedMinutes,
      remainingMinutes: sum(open),
      skippedMinutes: sum(skipped),
      overdueTasks: overdue.length,
      overdueMinutes: sum(overdue),
      revisionTotal: revision.length,
      revisionCompleted: revision.filter((t) => t.status === 'COMPLETED').length,
      topicsTotal: topics.length,
      topicsCompleted: topicProgress.filter((t) => t.status === 'COMPLETED').length,
      topicsDeferred: topicProgress.filter((t) => t.status === 'DEFERRED').length,
      completionPct:
        plannedMinutes === 0 ? 0 : Math.round((completedMinutes / plannedMinutes) * 100),
    },
    topics: topicProgress,
  };
}

/** One row per date that is a study day or holds a task, in date order. */
export function summarizeDays(
  calendar: readonly DayCapacity[],
  tasks: readonly ProgressTask[],
): DaySummary[] {
  const dates = new Set<string>([...calendar.map((d) => d.date), ...tasks.map((t) => t.date)]);
  const capacity = new Map(calendar.map((d) => [d.date, d.usable]));
  return [...dates].sort().map((date) => {
    const own = tasks.filter((t) => t.date === date && t.status !== 'SKIPPED');
    return {
      date,
      capacityMinutes: capacity.get(date) ?? 0,
      plannedMinutes: sum(own),
      completedMinutes: sum(own.filter((t) => t.status === 'COMPLETED')),
      revisionMinutes: sum(own.filter((t) => t.type === 'REVISION')),
      taskCount: own.length,
    };
  });
}
