// The tests of the quick notes.
//
// A quick note is a note the user starts without naming it and without
// choosing a folder for it: one command creates it, and the user renames it
// later. The quick notes stand at the top of the tree, in a zone of their
// own: a note is never shown twice.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { QuickNotesZone } from '../components/sections/QuickNotesZone';
import {
  isQuickNoteName,
  quickNoteName,
  quickNotes,
  renameQuickNote,
} from '../core/quicknotes/quickNotes';
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

describe('the quick notes', () => {
  it('names the first quick note', () => {
    expect(quickNoteName([])).toBe('Untitled.md');
  });

  it('numbers the quick notes that follow', () => {
    expect(quickNoteName(['Untitled.md'])).toBe('Untitled 2.md');
    expect(quickNoteName(['Untitled.md', 'Untitled 2.md'])).toBe('Untitled 3.md');
  });

  it('knows the names of the quick notes', () => {
    expect(isQuickNoteName('Untitled.md')).toBe(true);
    expect(isQuickNoteName('Untitled 3.md')).toBe(true);
    expect(isQuickNoteName('Ideas.md')).toBe(false);
  });

  it('lists the quick notes of the vault', () => {
    const files = [file('Untitled.md'), file('Ideas.md'), file('journal/Untitled.md', 'journal')];
    expect(quickNotes(files).map((note) => note.path)).toEqual(['Untitled.md']);
  });

  it('accepts a new name for a quick note', () => {
    const files = [file('Untitled.md')];
    expect(renameQuickNote(files, 'Untitled.md', 'Ideas')).toEqual({ ok: true, name: 'Ideas.md' });
  });

  it('refuses an empty name', () => {
    expect(renameQuickNote([file('Untitled.md')], 'Untitled.md', '  ')).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('refuses a name that another note already carries', () => {
    const files = [file('Untitled.md'), file('Ideas.md')];
    expect(renameQuickNote(files, 'Untitled.md', 'Ideas.md')).toEqual({
      ok: false,
      reason: 'taken',
    });
  });

  it('refuses a name a file may not carry', () => {
    expect(renameQuickNote([file('Untitled.md')], 'Untitled.md', 'a/b')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });
});

describe('the zone of the quick notes', () => {
  const notes = [file('Untitled.md')];

  it('shows the name of the zone and the quick notes of the vault', () => {
    render(
      <QuickNotesZone
        notes={notes}
        currentPath=""
        onOpenNote={() => undefined}
        onCreate={() => undefined}
      />,
    );
    expect(screen.getByText('Quick notes')).toBeTruthy();
    expect(screen.getByText('Untitled.md')).toBeTruthy();
  });

  it('opens the quick note the user chooses', () => {
    const onOpenNote = vi.fn();
    render(
      <QuickNotesZone
        notes={notes}
        currentPath=""
        onOpenNote={onOpenNote}
        onCreate={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText('Untitled.md'));
    expect(onOpenNote).toHaveBeenCalledWith('Untitled.md');
  });

  it('asks for a new quick note', () => {
    const onCreate = vi.fn();
    render(
      <QuickNotesZone
        notes={notes}
        currentPath=""
        onOpenNote={() => undefined}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New quick note' }));
    expect(onCreate).toHaveBeenCalled();
  });

  it('can be folded away', () => {
    render(
      <QuickNotesZone
        notes={notes}
        currentPath=""
        onOpenNote={() => undefined}
        onCreate={() => undefined}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Hide the quick notes' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.queryByText('Untitled.md')).toBeNull();
    const folded = screen.getByRole('button', { name: 'Show the quick notes' });
    expect(folded.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the zone of the quick notes even when it is empty', () => {
    render(
      <QuickNotesZone
        notes={[]}
        currentPath=""
        onOpenNote={() => undefined}
        onCreate={() => undefined}
      />,
    );
    expect(screen.getByText('Quick notes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New quick note' })).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('counts the quick notes of the zone', () => {
    render(
      <QuickNotesZone
        notes={[file('Untitled.md'), file('Untitled 2.md')]}
        currentPath=""
        onOpenNote={() => undefined}
        onCreate={() => undefined}
      />,
    );
    expect(screen.getByText('2')).toBeTruthy();
  });
});
