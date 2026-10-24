// The notes of the vault by day.
//
// A note belongs to two days: the day it was created on and the day it was
// changed on. A note that was written in the past and edited today is shown on
// both days, like in Mem.
//
// The dates come from the tree of the vault: the note carries the two moments
// of its life as ISO 8601 strings. The module does not read the storage and
// does not know the interface.

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
