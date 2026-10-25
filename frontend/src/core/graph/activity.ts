// The activity of the vault: how many notes were written on each day.
//
// The module is pure: it counts the days of a list of notes and returns the
// series of the last days. The graph of the activity (the small bars of the
// footer of the sidebar) is drawn from that series.
import { dayKey } from '../calendar/dates';

/** A note, as the activity needs it. */
export interface ActivityEntry {
  /** The day the note was written. */
  createdAt?: string;
  /** The day the note was changed. */
  updatedAt?: string;
}

/** The activity of one day. */
export interface ActivityDay {
  /** The day, in the "YYYY-MM-DD" form. */
  date: string;
  /** The number of the notes that were written or changed that day. */
  count: number;
}

/** The number of the days the graph of the activity shows. */
export const ACTIVITY_DAYS = 14;

/** The day of a timestamp, in the local time of the machine. */
function dayOf(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dayKey(date);
}

/**
 * Counts the notes of each day.
 *
 * A note is counted on the day it was written and on the day it was changed.
 * A note that was written and changed on the same day is counted once.
 */
export function countActivityByDay(entries: readonly ActivityEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    // A note that was written and changed on the same day is counted once.
    const days = new Set([dayOf(entry.createdAt), dayOf(entry.updatedAt)]);
    for (const day of days) {
      if (!day) continue;
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The series of the last days, the oldest day first.
 *
 * The days without notes are part of the series: the graph shows the silence
 * as well as the work.
 */
export function buildActivityDays(
  counts: Map<string, number>,
  today: Date,
  days: number = ACTIVITY_DAYS,
): ActivityDay[] {
  const series: ActivityDay[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const key = dayKey(date);
    series.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return series;
}

/**
 * The level of a day, from 0 (nothing) to 4 (the busiest day).
 *
 * The levels are relative to the busiest day of the series, so that the graph
 * of a quiet vault is still readable.
 */
export function activityLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/** The activity of a list of notes, as the graph shows it. */
export function activitySeries(
  entries: readonly ActivityEntry[],
  today: Date,
  days: number = ACTIVITY_DAYS,
): ActivityDay[] {
  return buildActivityDays(countActivityByDay(entries), today, days);
}
