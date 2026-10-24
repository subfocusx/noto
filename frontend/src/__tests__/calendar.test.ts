import { describe, expect, it } from 'vitest';
import {
  buildMonthGrid,
  dayKey,
  MONTH_NAMES,
  monthKey,
  monthLabel,
  parseMonthKey,
  shiftMonth,
  WEEK_DAY_LABELS,
} from '../core/calendar/dates';
import { dayHasNotes, notesByDay, notesOnDay } from '../core/calendar/notes';

/** The month of today, as the core sees it. */
function currentMonth(): { year: number; month: number } {
  const today = new Date();
  return { year: today.getFullYear(), month: today.getMonth() + 1 };
}

describe('the keys of the calendar', () => {
  it('writes a day as YYYY-MM-DD with a zero in front of the small numbers', () => {
    expect(dayKey(new Date(2026, 9, 5))).toBe('2026-10-05');
    expect(dayKey(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('writes a month as YYYY-MM', () => {
    expect(monthKey(new Date(2026, 9, 5))).toBe('2026-10');
    expect(monthKey(new Date(2026, 0, 1))).toBe('2026-01');
  });

  it('reads a month out of its key', () => {
    expect(parseMonthKey('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseMonthKey('2026-1')).toEqual({ year: 2026, month: 1 });
  });

  it('falls back to the month of today when the key is broken', () => {
    expect(parseMonthKey('')).toEqual(currentMonth());
    expect(parseMonthKey('nonsense')).toEqual(currentMonth());
    expect(parseMonthKey('2026-13')).toEqual(currentMonth());
    expect(parseMonthKey('2026-00')).toEqual(currentMonth());
  });

  it('walks to the neighbouring months', () => {
    expect(shiftMonth('2026-10', -1)).toBe('2026-09');
    expect(shiftMonth('2026-10', 1)).toBe('2026-11');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', 3)).toBe('2027-01');
    expect(shiftMonth('2026-10', -12)).toBe('2025-10');
  });

  it('walks from the month of today when the key is broken', () => {
    const today = new Date();
    const previous = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    expect(shiftMonth('', -1)).toBe(monthKey(previous));
  });

  it('names the month for the interface', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('2026-01')).toBe('January 2026');
    expect(MONTH_NAMES[9]).toBe('October');
  });

  it('labels the days of the week in the order of the grid', () => {
    expect(WEEK_DAY_LABELS).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
  });
});

describe('the grid of a month', () => {
  it('has six rows of seven days', () => {
    expect(buildMonthGrid(2026, 10)).toHaveLength(42);
  });

  it('starts on the Monday of the week of the first day of the month', () => {
    // The 1st of October 2026 is a Thursday: the row starts on the Monday
    // before it, the 28th of September.
    const grid = buildMonthGrid(2026, 10);
    expect(grid[0]).toEqual({ key: '2026-09-28', day: 28, inMonth: false });
    expect(grid[3]).toEqual({ key: '2026-10-01', day: 1, inMonth: true });
    expect(grid[6]).toEqual({ key: '2026-10-04', day: 4, inMonth: true });
  });

  it('keeps every day of the month', () => {
    const days = buildMonthGrid(2026, 10).filter((cell) => cell.inMonth);
    expect(days).toHaveLength(31);
    expect(days[0]).toEqual({ key: '2026-10-01', day: 1, inMonth: true });
    expect(days[30]).toEqual({ key: '2026-10-31', day: 31, inMonth: true });
  });

  it('ends with the days of the next month', () => {
    const grid = buildMonthGrid(2026, 10);
    expect(grid[41]).toEqual({ key: '2026-11-08', day: 8, inMonth: false });
  });

  it('starts every row on a Monday', () => {
    const grid = buildMonthGrid(2026, 10);
    for (let row = 0; row < 6; row += 1) {
      const first = grid[row * 7];
      expect(new Date(`${first.key}T00:00:00`).getDay()).toBe(1);
    }
  });

  it('lays out a month that starts on a Sunday', () => {
    // The 1st of February 2026 is a Sunday: the row starts on the Monday
    // before it, the 26th of January.
    const grid = buildMonthGrid(2026, 2);
    expect(grid[0]).toEqual({ key: '2026-01-26', day: 26, inMonth: false });
    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(28);
  });
});

describe('the notes by day', () => {
  const note = (createdAt: string, updatedAt: string, path: string) => ({
    createdAt,
    updatedAt,
    path,
  });

  it('puts a note on the day of its creation and on the day of its change', () => {
    const byDay = notesByDay([note('2026-10-01T10:00:00', '2026-10-12T09:30:00', 'a.md')]);
    expect(byDay.get('2026-10-01')?.map((item) => item.path)).toEqual(['a.md']);
    expect(byDay.get('2026-10-12')?.map((item) => item.path)).toEqual(['a.md']);
  });

  it('puts a note once on a day when it was created and changed on it', () => {
    const byDay = notesByDay([note('2026-10-01T10:00:00', '2026-10-01T23:00:00', 'a.md')]);
    expect(byDay.get('2026-10-01')).toHaveLength(1);
  });

  it('ignores a note whose creation cannot be read', () => {
    const byDay = notesByDay([note('not a date', '2026-10-12T09:30:00', 'a.md')]);
    expect(byDay.size).toBe(0);
  });

  it('keeps a note on the day of its creation when the change cannot be read', () => {
    const byDay = notesByDay([note('2026-10-01T10:00:00', 'not a date', 'a.md')]);
    expect(byDay.get('2026-10-01')?.map((item) => item.path)).toEqual(['a.md']);
  });

  it('reads the day in the local time of the machine', () => {
    // A note written at 23:30 belongs to that evening, whatever the time zone
    // of the server is.
    const byDay = notesByDay([note('2026-10-01T23:30:00', '2026-10-01T23:30:00', 'a.md')]);
    expect(byDay.get('2026-10-01')).toHaveLength(1);
  });

  it('keeps the order of the tree', () => {
    const byDay = notesByDay([
      note('2026-10-01T10:00:00', '2026-10-01T10:00:00', 'first.md'),
      note('2026-10-02T10:00:00', '2026-10-01T12:00:00', 'second.md'),
    ]);
    expect(byDay.get('2026-10-01')?.map((item) => item.path)).toEqual([
      'first.md',
      'second.md',
    ]);
  });

  it('answers which day carries notes', () => {
    const byDay = notesByDay([note('2026-10-01T10:00:00', '2026-10-12T09:30:00', 'a.md')]);
    expect(dayHasNotes(byDay, '2026-10-01')).toBe(true);
    expect(dayHasNotes(byDay, '2026-10-02')).toBe(false);
    expect(notesOnDay(byDay, '2026-10-12')).toHaveLength(1);
    expect(notesOnDay(byDay, '2026-10-02')).toEqual([]);
  });
});
