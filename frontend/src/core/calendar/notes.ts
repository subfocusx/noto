// The notes of the vault by day.
//
// A note belongs to two days: the day it was created on and the day it was
// changed on. A note that was written in the past and edited today is shown on
// both days, like in Mem.
//
// A daily note is the exception: a note whose file name reads as a day
// (`2026-10-29.md`) belongs to that day and to that day only. The user thinks
// of it as "the note of the 29th", not as a note written on one day and changed
// on another, so the day of the name is the day of the calendar.
//
// The dates come from the tree of the vault: the note carries the two moments
// of its life as ISO 8601 strings and the name of its file. The module does
// not read the storage and does not know the interface.

/**
 * The part of a note that the calendar needs.
 *
 * The type is structural on purpose: the helper works with the node of the
 * tree and with a plain object of a test alike.
 */
export interface NoteLike {
  /** The moment the note was created, as an ISO 8601 string. */
  createdAt: string;
  /** The moment the note was changed, as an ISO 8601 string. */
  updatedAt: string;
  /** The name of the file of the note, as `2026-10-29.md`. */
  name?: string;
}

/**
 * The notes of every day, indexed by the key of the day.
 *
 * The order of the notes of a day is the order of the tree: the calendar does
 * not reorder the notes of the vault.
 */
export function notesByDay<T extends NoteLike = NoteLike>(
  files: readonly T[],
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();

  const add = (key: string | null, file: T): void => {
    if (!key) return;
    const notes = byDay.get(key);
    if (!notes) {
      byDay.set(key, [file]);
      return;
    }
    // A note that was created and changed on the same day belongs to that day
    // once, not twice.
    if (!notes.includes(file)) notes.push(file);
  };

  for (const file of files) {
    // A daily note belongs to the day of its name and to no other day: the day
    // it was written on and the day it was changed on do not add it to the
    // calendar.
    const daily = dayOfName(file.name);
    if (daily) {
      add(daily, file);
      continue;
    }
    // The creation is the anchor of a note: a note whose creation cannot be
    // read is ignored, because the day it was written on is unknown.
    const created = dayOfMoment(file.createdAt);
    if (!created) continue;
    add(created, file);
    add(dayOfMoment(file.updatedAt), file);
  }

  return byDay;
}

/** True when at least one note belongs to the day. */
export function dayHasNotes(
  byDay: ReadonlyMap<string, readonly NoteLike[]>,
  key: string,
): boolean {
  return (byDay.get(key)?.length ?? 0) > 0;
}

/** The notes of the day, in the order of the tree. */
export function notesOnDay<T extends NoteLike = NoteLike>(
  byDay: ReadonlyMap<string, readonly T[]>,
  key: string,
): T[] {
  const notes = byDay.get(key);
  return notes ? [...notes] : [];
}

/**
 * The key of the day of a moment, or `null` when the moment cannot be read.
 *
 * The moment is read as a local date: the day of a note is the day the user
 * lived, not the day of the time zone of the server.
 */
function dayOfMoment(moment: string): string | null {
  if (!moment) return null;
  const parsed = new Date(moment);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
  const day = `${parsed.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The key of the day of a daily note, or `null` when the name is not a day.
 *
 * The name of a daily note is the day alone: `2026-10-29` or `2026-10-29.md`.
 * A name that only starts with a day (`2026-10-29 meeting.md`) is not the name
 * of a day, and neither is an impossible day (`2026-13-45`).
 *
 * The day of the name is taken as it is and never read as a moment: a string
 * read as a date is the midnight of the time zone of the server, and it lands
 * on the wrong day in a negative offset.
 */
function dayOfName(name: string | undefined): string | null {
  if (!name) return null;
  const stem = name.endsWith('.md') ? name.slice(0, -'.md'.length) : name;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stem);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  // The name must read as a day that exists: the thirteenth month is not a
  // month and the thirty-second day is not a day.
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return match[0];
}
