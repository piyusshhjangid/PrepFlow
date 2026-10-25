import type { Plan, PlanSettings } from '../src/core/planner';
import { isActive } from '../src/core/priority';
import type { Topic } from '../src/core/types';

export interface Violations {
  /** Days whose tasks exceed the daily time. */
  capacity: number;
  /** Any other broken rule, in words. */
  other: string[];
}

/**
 * Rules every plan must satisfy whatever the topics are. This is the same list the planner's own random
 * test checks, written as a reusable function so the evaluation can apply it to plans built from real
 * (model- or rule-extracted) topics.
 */
export function checkPlan(topics: Topic[], s: PlanSettings, p: Plan): Violations {
  const other: string[] = [];
  let capacity = 0;
  const all = p.days.flatMap((d) => d.tasks);
  for (const d of p.days) if (d.usedMinutes > s.minutesPerDay) capacity++;
  for (const t of all) {
    if (!(t.date >= s.today && t.date < s.examDate)) other.push(`${t.id} is outside today..exam`);
    if (t.kind === 'study' && t.minutes > s.sessionMinutes)
      other.push(`${t.id} exceeds the session length`);
    if (t.minutes % 5 !== 0) other.push(`${t.id} is not a multiple of 5 minutes`);
  }
  if (p.stats.scheduledStudyMinutes + p.stats.unscheduledMinutes !== p.stats.requiredMinutes)
    other.push('scheduled + unscheduled minutes do not equal required minutes');
  if (new Set(all.map((t) => t.id)).size !== all.length) other.push('duplicate task ids');
  const days = (id: string, kind: 'study' | 'revision') =>
    all
      .filter((t) => t.kind === kind && t.topicId === id)
      .map((t) => t.date)
      .sort();
  for (const t of topics.filter(isActive)) {
    const mine = days(t.id, 'study');
    for (const pre of t.prerequisites) {
      const pt = topics.find((x) => x.id === pre);
      if (!pt || !isActive(pt) || mine.length === 0) continue;
      if (p.unscheduled.some((u) => u.topicId === pre))
        other.push(`${t.id} planned before unfinished ${pre}`);
      else if ((days(pre, 'study').at(-1) ?? '') > mine[0]!)
        other.push(`${t.id} starts before ${pre} ends`);
    }
    const last = mine.at(-1);
    for (const r of days(t.id, 'revision'))
      if (!last || r <= last) other.push(`review of ${t.id} is not after study`);
  }
  return { capacity, other };
}
