// The dates of the calendar.
//
// The calendar of the application shows the notes of the vault by day. The
// dates here are always *local* dates: the user reads the calendar in the time
// of the machine, so a note written at 23:30 belongs to that evening and never
// to another day of another time zone.
//
// The module is pure: it knows nothing about the interface and nothing about
// the storage. It only knows how a day is written down (`YYYY-MM-DD`), how a
// month is written down (`YYYY-MM`) and how the days of a month are laid out
// in a grid of six rows of seven days that starts on Monday.

/** A cell of the grid of a month. */
export interface CalendarCell {
  /** The day, as `YYYY-MM-DD`. */
  key: string;
  /** The number of the day in its own month. */
  day: number;
  /** False for the days of the neighbouring months. */
  inMonth: boolean;
}

/**
 * The labels of the days of the week, in the order of the grid.
 *
 * The grid starts on Monday, like the calendar of Mem and of Obsidian. The
 * labels are short on purpose: the column of the rail is narrow.
 */
export const WEEK_DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

/** The names of the months, in the order of the year. */
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The number of the rows of the grid: the grid of a month is always six rows high. */
export const MONTH_GRID_ROWS = 6;

/** The number of the days of a row. */
const DAYS_PER_WEEK = 7;

/**
 * The key of a day: the local date as `YYYY-MM-DD`.
 *
 * The month and the day are padded with a zero, so the keys of the days can be
 * compared as strings.
 */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The key of a month: the local month as `YYYY-MM`. */
export function monthKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Reads a month out of its key.
 *
 * The month is 1…12, the way `Date` counts the months. A key that cannot be
 * read falls back to the month of today: a broken key must never empty the
 * calendar.
 */
export function parseMonthKey(key: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{1,2})$/.exec(key.trim());
  if (!match) return currentMonth();
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1 || month < 1 || month > 12) return currentMonth();
  return { year, month };
}

/**
 * The month that follows the given one (or the one before it).
 *
 * A delta of -1 gives the previous month, a delta of 1 the next one. A key
 * that cannot be read falls back to the month of today, like `parseMonthKey`.
 */
export function shiftMonth(key: string, delta: number): string {
  const { year, month } = parseMonthKey(key);
  const months = year * 12 + (month - 1) + Math.trunc(delta);
  const shiftedYear = Math.floor(months / 12);
  const shiftedMonth = ((months % 12) + 12) % 12;
  return `${shiftedYear}-${`${shiftedMonth + 1}`.padStart(2, '0')}`;
}

/**
 * The cells of a month: six rows of seven days, starting on Monday.
 *
 * The days of the neighbouring months are in the grid too, with `inMonth` set
 * to false: this is how Mem and Obsidian draw their month, and a grid with
 * holes in it would jump while the user walks through the months.
 */
export function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const first = makeDate(year, month, 1);
  const offset = (first.getDay() + 6) % DAYS_PER_WEEK;
  const start = makeDate(year, month, 1 - offset);

  const cells: CalendarCell[] = [];
  for (let index = 0; index < MONTH_GRID_ROWS * DAYS_PER_WEEK; index += 1) {
    const date = makeDate(
      start.getFullYear(),
      start.getMonth() + 1,
      start.getDate() + index,
    );
    cells.push({
      key: dayKey(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month - 1 && date.getFullYear() === year,
    });
  }
  return cells;
}

/**
 * The name of a month for the interface: "October 2026".
 *
 * The name is written in English on purpose: the interface of Noto is in
 * English and the calendar must not depend on the locale of the machine.
 */
export function monthLabel(key: string): string {
  const { year, month } = parseMonthKey(key);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** The month of today. */
function currentMonth(): { year: number; month: number } {
  const today = new Date();
  return { year: today.getFullYear(), month: today.getMonth() + 1 };
}

/**
 * A local date.
 *
 * `new Date(year, ...)` moves the years 0…99 into the twentieth century, so
 * the year is set back by hand when it is one of them.
 */
function makeDate(year: number, month: number, day: number): Date {
  const date = new Date(year, month - 1, day);
  if (year >= 0 && year < 100) date.setFullYear(year);
  return date;
}
