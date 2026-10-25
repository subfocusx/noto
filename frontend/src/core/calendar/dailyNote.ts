// The daily note of a day.
//
// The calendar of the application knows the days of the vault. A day may have
// a daily note: a note named after the day ("2026-10-24.md"). The calendar
// creates that note by itself when it is missing, so that the user never has
// to create it by hand before writing in it.
//
// The module knows the name of the daily note and how to find it; the writing
// is done by the caller, through the small interface {@link EnsureDailyNoteDeps}.
import type { Node } from '../../types';

/** The names of the daily notes ("2026-10-24.md"). */
export const DAILY_NOTE_PATTERN = /^\d{4}-\d{2}-\d{2}\.md$/;

/** The name of the daily note of a day. */
export function dailyNoteName(day: string): string {
  return `${day.trim()}.md`;
}

/** True when the name is the name of a daily note. */
export function isDailyNoteName(name: string): boolean {
  return DAILY_NOTE_PATTERN.test(name.trim());
}

/** The path of the daily note of a day, in a folder of the vault. */
export function dailyNotePath(day: string, parentPath = ''): string {
  const name = dailyNoteName(day);
  return parentPath ? `${parentPath}/${name}` : name;
}

/**
 * The daily note of a day, among the notes of the vault.
 *
 * The note may live at the root of the vault or in a folder: the calendar
 * looks everywhere.
 */
export function findDailyNote(files: readonly Node[], day: string): Node | null {
  const name = dailyNoteName(day).toLowerCase();
  const found = files.find((file) => file.type === 'file' && file.name.toLowerCase() === name);
  return found ?? null;
}

/** True when the day has a daily note. */
export function hasDailyNote(files: readonly Node[], day: string): boolean {
  return findDailyNote(files, day) !== null;
}

/** What the calendar needs to create a daily note. */
export interface EnsureDailyNoteDeps {
  /** The notes of the vault. */
  files: readonly Node[];
  /** Creates the note and answers with it. */
  create(parentPath: string, name: string): Promise<Node>;
}

/** The result of the creation of a daily note. */
export interface EnsureDailyNoteResult {
  /** The note of the day, when it could be found or created. */
  node: Node | null;
  /** True when the note was created by this call. */
  created: boolean;
}

/**
 * Makes sure that the day has a daily note, and creates it when it has none.
 *
 * The function never throws: a storage that refuses the creation must not
 * break the calendar. The caller sees a null node and decides what to do.
 */
export async function ensureDailyNote(
  day: string,
  deps: EnsureDailyNoteDeps,
  parentPath = '',
): Promise<EnsureDailyNoteResult> {
  const existing = findDailyNote(deps.files, day);
  if (existing) return { node: existing, created: false };
  try {
    const node = await deps.create(parentPath, dailyNoteName(day));
    return { node, created: true };
  } catch {
    return { node: null, created: false };
  }
}
