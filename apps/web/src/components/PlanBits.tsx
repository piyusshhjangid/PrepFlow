import type { PriorityLevel, PriorityTier, TaskStatus, TaskType } from '@prepflow/shared';
import { formatMinutes } from '../lib/format';

const LEVEL_STYLE: Record<PriorityLevel, string> = {
  HIGH: 'border-rose-200 bg-rose-50 text-rose-800',
  MEDIUM: 'border-amber-200 bg-amber-50 text-amber-800',
  LOW: 'border-slate-200 bg-slate-50 text-slate-700',
};

export function LevelBadge({ level }: { level: PriorityLevel }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${LEVEL_STYLE[level]}`}>
      {level}
    </span>
  );
}

export const TIER_LABEL: Record<PriorityTier, string> = {
  MUST: 'Must study',
  SHOULD: 'Should study',
  IF_TIME: 'If time remains',
  DEFER: 'Deferred',
};

export function TierBadge({ tier }: { tier: PriorityTier }) {
  return (
    <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700">
      {TIER_LABEL[tier]}
    </span>
  );
}

export const TYPE_LABEL: Record<TaskType, string> = { STUDY: 'Learn', REVISION: 'Revision' };

export function TypeBadge({ type, index }: { type: TaskType; index?: number | null }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-xs ${
        type === 'REVISION'
          ? 'border-violet-200 bg-violet-50 text-violet-800'
          : 'border-sky-200 bg-sky-50 text-sky-800'
      }`}
    >
      {type === 'REVISION' && index ? `Revision ${index}` : TYPE_LABEL[type]}
    </span>
  );
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: 'To do',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Done',
  SKIPPED: 'Skipped',
};

export function ProgressBar({
  value,
  max,
  label,
  tone = 'indigo',
}: {
  value: number;
  max: number;
  label: string;
  tone?: 'indigo' | 'emerald' | 'amber';
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const color = { indigo: 'bg-indigo-600', emerald: 'bg-emerald-600', amber: 'bg-amber-500' }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
    >
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-slate-900">{value}</dd>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export { formatMinutes };
