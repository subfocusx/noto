// The archive: the notes the tree cannot show.
//
// The tree of the interface groups the notes by the folder they live in. A
// note whose folder is not in the vault any more (the folder was deleted
// outside of the application, or the note was moved by another tool) has no
// place in the tree: the user cannot reach it from the tree, but the note is
// still there, with its content.
//
// The archive is the list of those notes. The module is pure: it compares the
// notes and the folders of the vault and answers the question.
import type { Node } from '../../types';

/**
 * True when the tree can show the note.
 *
 * A note lives at the root of the vault or in a folder of the vault; anything
 * else is a note the tree cannot place.
 */
export function isInTree(file: Node, folders: readonly Node[]): boolean {
  if (!file.parentPath) return true;
  return folders.some((folder) => folder.path === file.parentPath);
}

/**
 * The notes of the vault that the tree cannot show.
 *
 * The notes are sorted by path, so the archive always reads the same way.
 */
export function archiveNotes(files: readonly Node[], folders: readonly Node[]): Node[] {
  return files
    .filter((file) => !isInTree(file, folders))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The number of the notes of the archive. */
export function archiveCount(files: readonly Node[], folders: readonly Node[]): number {
  return archiveNotes(files, folders).length;
}
