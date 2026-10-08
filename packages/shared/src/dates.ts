/**
 * Calendar-date helpers. PrepFlow works with whole calendar days ("2026-10-11"), never with
 * times of day, and treats every date as UTC midnight so results are identical on the server,
 * in the browser and in tests regardless of the machine's time zone.
 *
 * Known limitation (documented in docs/decisions/): "today" is the UTC date, which can differ
 * from the student's local date for a few hours each day. A per-exam time zone is a later improvement.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseIsoDate(value: string): Date {
  if (!isValidIsoDate(value)) throw new Error(`Invalid ISO date: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's UTC calendar date as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

export function addDaysIso(value: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(value).getTime() + days * DAY_MS));
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function diffDaysIso(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY_MS);
}
