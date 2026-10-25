// The tests of the archive.
//
// The archive holds the notes the tree cannot show: the notes whose folder is
// not in the vault any more. The module is pure, so the tests give it the
// notes and the folders of a vault.
import { describe, expect, it } from 'vitest';
import { archiveCount, archiveNotes, isInTree } from '../core/views/archive';
import type { Node } from '../types';

/** A note of the vault of the tests. */
function file(path: string, parentPath = ''): Node {
  return {
    id: path,
    name: path.split('/').pop() ?? path,
    path,
    type: 'file',
    parentPath,
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

/** A folder of the vault of the tests. */
function folder(path: string, parentPath = ''): Node {
  return { ...file(path, parentPath), type: 'folder' };
}

describe('the archive of the notes', () => {
  it('keeps the note at the root of the vault in the tree', () => {
    expect(isInTree(file('a.md'), [])).toBe(true);
  });

  it('keeps the note of a folder of the vault in the tree', () => {
    const folders = [folder('journal')];
    expect(isInTree(file('journal/a.md', 'journal'), folders)).toBe(true);
  });

  it('takes the note of a missing folder out of the tree', () => {
    expect(isInTree(file('journal/a.md', 'journal'), [])).toBe(false);
  });

  it('lists the notes the tree cannot show', () => {
    const files = [file('a.md'), file('journal/b.md', 'journal'), file('lost/c.md', 'lost')];
    const folders = [folder('journal')];
    expect(archiveNotes(files, folders).map((note) => note.path)).toEqual(['lost/c.md']);
  });

  it('sorts the notes of the archive by their path', () => {
    const files = [file('b/lost.md', 'b'), file('a/lost.md', 'a')];
    expect(archiveNotes(files, []).map((note) => note.path)).toEqual(['a/lost.md', 'b/lost.md']);
  });

  it('counts the notes of the archive', () => {
    const files = [file('a.md'), file('lost/c.md', 'lost')];
    expect(archiveCount(files, [])).toBe(1);
  });
});
