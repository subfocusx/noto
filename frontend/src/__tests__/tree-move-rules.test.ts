import { describe, expect, it } from 'vitest';
import { canMoveInto, refusalOfMove } from '../lib/tree';
import type { Node } from '../types';

function node(path: string, name: string, parentPath: string, type: 'file' | 'folder'): Node {
  return {
    id: path,
    name,
    path,
    type,
    parentPath,
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

const folderJournal = node('journal', 'journal', '', 'folder');
const folderInner = node('journal/inner', 'inner', 'journal', 'folder');
const noteInJournal = node('journal/a.md', 'a.md', 'journal', 'file');
const noteInInner = node('journal/inner/b.md', 'b.md', 'journal/inner', 'file');
const noteAtRoot = node('c.md', 'c.md', '', 'file');

describe('the rules of a move', () => {
  it('lets a note move into another folder', () => {
    expect(refusalOfMove(noteAtRoot, 'journal')).toBeNull();
    expect(canMoveInto(noteAtRoot, 'journal')).toBe(true);
  });

  it('lets a note of a subfolder move up to a folder of its parents', () => {
    expect(refusalOfMove(noteInInner, 'journal')).toBeNull();
  });

  it('refuses a note that already lives in the folder', () => {
    expect(refusalOfMove(noteInJournal, 'journal')).toBe('already-there');
    expect(canMoveInto(noteInJournal, 'journal')).toBe(false);
  });

  it('refuses a note that already lives in the root', () => {
    expect(refusalOfMove(noteAtRoot, '')).toBe('already-there');
  });

  it('refuses a folder that would land inside itself', () => {
    expect(refusalOfMove(folderJournal, 'journal')).toBe('into-itself');
    expect(canMoveInto(folderJournal, 'journal')).toBe(false);
  });

  it('refuses a folder that would land inside one of its own descendants', () => {
    expect(refusalOfMove(folderJournal, 'journal/inner')).toBe('into-itself');
  });

  it('lets a folder move into another folder', () => {
    expect(refusalOfMove(folderJournal, 'archive')).toBeNull();
    expect(canMoveInto(folderJournal, 'archive')).toBe(true);
  });

  it('refuses a folder that already lives in the target folder', () => {
    expect(refusalOfMove(folderInner, 'journal')).toBe('already-there');
  });

  it('refuses a folder that already lives in the root', () => {
    expect(refusalOfMove(folderJournal, '')).toBe('already-there');
  });

  it('does not confuse a folder with a note whose name starts the same way', () => {
    // The folder `journal-2` is not inside the folder `journal`.
    const sibling = node('journal-2', 'journal-2', '', 'folder');
    expect(refusalOfMove(sibling, 'journal')).toBeNull();
  });
});
