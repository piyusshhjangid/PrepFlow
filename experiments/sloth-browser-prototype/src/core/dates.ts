/** All dates are plain `YYYY-MM-DD` strings; arithmetic goes through UTC day numbers, so no time zone or DST surprises. */
export type ISODate = string;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: string): boolean {
  const m = ISO.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function toDayNumber(date: ISODate): number {
  if (!isISODate(date)) throw new RangeError(`Not a valid date: ${date}`);
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, mo - 1, d) / 86_400_000);
}

export function fromDayNumber(day: number): ISODate {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** The user's local calendar date (what "today" means to a student), not the UTC date. */
export function localToday(now: Date = new Date()): ISODate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDay(date: ISODate): string {
  const t = new Date(toDayNumber(date) * 86_400_000);
  return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}
