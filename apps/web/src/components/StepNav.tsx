import { NavLink } from 'react-router';
import { getExamId } from '../workspace';

/** The journey: Setup → Materials → Analysis → Plan → Today → Progress. Shown once a workspace exists. */
const STEPS = [
  ['/setup', 'Setup'],
  ['/material', 'Materials'],
  ['/analysis', 'Analysis'],
  ['/plan', 'Plan'],
  ['/today', 'Today'],
  ['/progress', 'Progress'],
] as const;

export function StepNav() {
  if (!getExamId()) return null;
  return (
    <nav aria-label="Steps" className="border-b border-slate-200 bg-white">
      <ol className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 py-2 text-sm">
        {STEPS.map(([to, label], index) => (
          <li key={to} className="shrink-0">
            <NavLink
              to={to}
              className={({ isActive }) =>
                `rounded px-2.5 py-1 ${
                  isActive
                    ? 'bg-indigo-50 font-medium text-indigo-800'
                    : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <span aria-hidden="true" className="mr-1 text-xs text-slate-400">
                {index + 1}
              </span>
              {label}
            </NavLink>
          </li>
        ))}
      </ol>
    </nav>
  );
}
