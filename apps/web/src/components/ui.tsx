import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { StepNav } from './StepNav';

const buttonBase =
  'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const variants = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100',
  danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
} as const;

type Variant = keyof typeof variants;

export function Button({
  variant = 'primary',
  busy = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={`${buttonBase} ${variants[variant]} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  variant = 'primary',
  children,
}: {
  to: string;
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={`${buttonBase} ${variants[variant]}`}>
      {children}
    </Link>
  );
}

const alertStyles = {
  error: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
} as const;

/** Errors are announced to screen readers immediately; other messages politely. */
export function Alert({ kind, children }: { kind: keyof typeof alertStyles; children: ReactNode }) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-4 py-3 text-sm ${alertStyles[kind]}`}
    >
      {children}
    </div>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight text-slate-900">
            PrepFlow
          </Link>
        </div>
      </header>
      <StepNav />
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      {title && <h2 className="mb-3 text-base font-semibold">{title}</h2>}
      {children}
    </section>
  );
}
