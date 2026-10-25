// The quick notes.
//
// A quick note is a note the user starts without thinking about its name and
// without choosing a folder for it: one command creates it at the root of the
// vault, and the user renames it when she knows what she wants to write.
//
// The notes of the vault are files, so a quick note has a name on the disk
// ("Untitled.md"); the name is a placeholder, not a choice of the user. The
// module is pure: it decides the name of a new quick note, recognises the
// quick notes of a vault and checks the rename that the user asks for.
import type { Node } from '../../types';
import { t } from '../../i18n';

/** The name a quick note gets when the user does not choose one. */
export const QUICK_NOTE_BASE = 'Untitled';

/** The names of the quick notes ("Untitled.md", "Untitled 2.md", ...). */
export const QUICK_NOTE_PATTERN = /^Untitled(?: \d+)?\.md$/i;

/** The characters a note name may not carry. */
const FORBIDDEN = /[\\/:*?"<>|]/;

/**
 * The name of a new quick note.
 *
 * The first quick note is "Untitled.md"; the next ones are numbered, so that
 * two quick notes never share a name.
 */
export function quickNoteName(taken: readonly string[], base: string = QUICK_NOTE_BASE): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  const first = `${base}.md`;
  if (!used.has(first.toLowerCase())) return first;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} ${index}.md`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error(t('quickNotes.tooMany'));
}

/** True when the name is the name of a quick note. */
export function isQuickNoteName(name: string): boolean {
  return QUICK_NOTE_PATTERN.test(name);
}

/**
 * The quick notes of the vault.
 *
 * A quick note lives at the root of the vault: it was created without a
 * folder. The notes are sorted by path, so the list never jumps around.
 */
export function quickNotes(files: readonly Node[]): Node[] {
  return files
    .filter((file) => file.type === 'file' && !file.parentPath && isQuickNoteName(file.name))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The result of a rename of a quick note. */
export type QuickNoteRename =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'forbidden' | 'taken' };

/**
 * Checks the new name of a quick note.
 *
 * The name must not be empty, must not carry a character a file name may not
 * carry, and must not be the name of another note of the same folder.
 */
export function renameQuickNote(
  files: readonly Node[],
  path: string,
  newName: string,
): QuickNoteRename {
  const trimmed = newName.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (FORBIDDEN.test(trimmed)) return { ok: false, reason: 'forbidden' };
  const name = trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`;
  const target = files.find((file) => file.path === path);
  const parent = target?.parentPath ?? '';
  const taken = files.some(
    (file) => file.path !== path && file.parentPath === parent && file.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) return { ok: false, reason: 'taken' };
  return { ok: true, name };
}
