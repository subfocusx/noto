// The tests of the pins.
//
// The pins are the notes the user keeps at the top of the tree. They live in
// the local storage of the browser, like the favorites and the views.
import { afterEach, describe, expect, it } from 'vitest';
import {
  isPinned,
  loadPins,
  parsePins,
  partitionPins,
  pinnedNodes,
  pinnedNotes,
  PINS_KEY,
  setPins,
  togglePinIn,
} from '../core/pin/pins';
import type { Node } from '../types';

/** A note of the vault of the tests. */
function file(path: string): Node {
  return {
    id: path,
    name: path.split('/').pop() ?? path,
    path,
    type: 'file',
    parentPath: '',
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

afterEach(() => {
  localStorage.clear();
  setPins([]);
});

describe('the pins of the notes', () => {
  it('reads the pins of the storage', () => {
    localStorage.setItem(PINS_KEY, JSON.stringify(['a.md', 'b.md']));
    expect(loadPins()).toEqual(['a.md', 'b.md']);
  });

  it('reads nothing out of a broken storage', () => {
    localStorage.setItem(PINS_KEY, 'not a list');
    expect(loadPins()).toEqual([]);
  });

  it('drops the entries that are not the path of a note', () => {
    expect(parsePins(JSON.stringify(['a.md', 42, '', 'a.md']))).toEqual(['a.md']);
  });

  it('writes the pins into the storage', () => {
    setPins(['a.md']);
    expect(parsePins(localStorage.getItem(PINS_KEY))).toEqual(['a.md']);
  });

  it('pins a note at the end of the list', () => {
    expect(togglePinIn(['a.md'], 'b.md')).toEqual(['a.md', 'b.md']);
  });

  it('unpins a note that is pinned', () => {
    expect(togglePinIn(['a.md', 'b.md'], 'a.md')).toEqual(['b.md']);
  });

  it('tells whether a note is pinned', () => {
    expect(isPinned(['a.md'], 'a.md')).toBe(true);
    expect(isPinned(['a.md'], 'b.md')).toBe(false);
  });

  it('keeps the order of the pins', () => {
    const notes = [file('a.md'), file('b.md')];
    expect(pinnedNotes(notes, ['b.md', 'a.md']).map((note) => note.path)).toEqual([
      'b.md',
      'a.md',
    ]);
  });

  it('drops the pins of the notes that do not exist any more', () => {
    const notes = [file('a.md')];
    expect(pinnedNodes(notes, ['a.md', 'gone.md']).map((note) => note.path)).toEqual(['a.md']);
  });

  it('splits the notes into the pinned ones and the other ones', () => {
    const notes = [file('a.md'), file('b.md')];
    const { pinned, rest } = partitionPins(notes, ['b.md']);
    expect(pinned.map((note) => note.path)).toEqual(['b.md']);
    expect(rest.map((note) => note.path)).toEqual(['a.md']);
  });
});
