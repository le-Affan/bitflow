/**
 * UTC calendar days as plain "YYYY-MM-DD" strings. Integer math only: no JavaScript Date in local time,
 * so a day can never shift for users outside UTC. Proleptic Gregorian calendar, years 0001-9999.
 */

export type Ymd = string; // "YYYY-MM-DD"

export interface YearMonth {
  year: number;
  month: number; // 1-12
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
export const WEEKDAY_SHORT = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const; // weeks start on Monday
const WEEKDAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

export function formatYmd(year: number, month: number, day: number): Ymd {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Parses a "YYYY-MM-DD" string; null if malformed or not a real calendar day. */
export function parseYmd(value: string): { year: number; month: number; day: number } | null {
  const m = YMD.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidYmd(value: string): boolean {
  return parseYmd(value) !== null;
}

/** UTC day of the Bitcoin genesis block (a protocol fact, not stored data). Nothing can exist before it. */
export const FIRST_BITCOIN_DAY: Ymd = "2009-01-03";

export function isBeforeBitcoin(value: Ymd): boolean {
  return value < FIRST_BITCOIN_DAY;
}

/** Today's date in UTC. `now` is injectable for tests; only its UTC fields are read. */
export function todayUtc(now: Date = new Date()): Ymd {
  return formatYmd(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

/** A date the user may select: a real calendar day that is not after today (UTC). No lower limit. */
export function isSelectable(value: string, today: Ymd): boolean {
  return isValidYmd(value) && value <= today; // zero-padded 4-digit years compare correctly as strings
}

// Days since 1970-01-01 (Howard Hinnant's days_from_civil / civil_from_days), exact for all years.
function toDayNumber(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDayNumber(n: number): Ymd {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return formatYmd(era * 400 + yoe + (month <= 2 ? 1 : 0), month, day);
}

export function addDays(value: Ymd, days: number): Ymd {
  const p = parseYmd(value);
  if (!p) throw new RangeError(`invalid date ${value}`);
  return fromDayNumber(toDayNumber(p.year, p.month, p.day) + days);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(value: Ymd): number {
  const p = parseYmd(value);
  if (!p) throw new RangeError(`invalid date ${value}`);
  return (((toDayNumber(p.year, p.month, p.day) + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

export function yearMonthOf(value: Ymd): YearMonth {
  const p = parseYmd(value);
  if (!p) throw new RangeError(`invalid date ${value}`);
  return { year: p.year, month: p.month };
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/** Clamps a month to the range [0001-01, month of `today`]. */
export function clampYearMonth(ym: YearMonth, today: Ymd): YearMonth {
  const max = yearMonthOf(today);
  if (compareYearMonth(ym, max) > 0) return max;
  if (ym.year < 1) return { year: 1, month: 1 };
  return ym;
}

/** Same day-of-month in another month, clamped to that month's length and to today. */
export function moveToMonth(value: Ymd, target: YearMonth, today: Ymd): Ymd {
  const p = parseYmd(value)!;
  const ym = clampYearMonth(target, today);
  const candidate = formatYmd(ym.year, ym.month, Math.min(p.day, daysInMonth(ym.year, ym.month)));
  return candidate > today ? today : candidate;
}

/** Weeks (Monday first) of a month; null marks cells outside the month. */
export function monthGrid({ year, month }: YearMonth): (Ymd | null)[][] {
  const first = formatYmd(year, month, 1);
  const cells: (Ymd | null)[] = Array(weekdayIndex(first)).fill(null);
  for (let d = 1; d <= daysInMonth(year, month); d++) cells.push(formatYmd(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Ymd | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "Friday, 9 October 2026" (UTC calendar day, no time zone conversion). */
export function longLabel(value: Ymd): string {
  const p = parseYmd(value)!;
  return `${WEEKDAY_LONG[weekdayIndex(value)]}, ${p.day} ${MONTH_NAMES[p.month - 1]} ${p.year}`;
}
