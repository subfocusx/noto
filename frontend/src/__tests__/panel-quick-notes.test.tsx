// The tests of the quick notes.
//
// A quick note is a note the user starts without naming it and without
// choosing a folder for it: one command creates it, and the user renames it
// later.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { QuickNotesSection } from '../components/sections/QuickNotesSection';
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

describe('the section of the quick notes', () => {
  const files = [file('Untitled.md'), file('Ideas.md')];

  it('lists the quick notes of the vault', () => {
    render(
      <QuickNotesSection
        files={files}
        onOpenNote={() => undefined}
        onRename={() => undefined}
        onCreate={() => undefined}
      />,
    );
    expect(screen.getByText('Untitled.md')).toBeTruthy();
    expect(screen.queryByText('Ideas.md')).toBeNull();
  });

  it('opens the quick note the user chooses', () => {
    const onOpenNote = vi.fn();
    render(
      <QuickNotesSection
        files={files}
        onOpenNote={onOpenNote}
        onRename={() => undefined}
        onCreate={() => undefined}
      />,
    );
    fireEvent.click(screen.getByText('Untitled.md'));
    expect(onOpenNote).toHaveBeenCalledWith('Untitled.md');
  });

  it('asks for a new quick note', () => {
    const onCreate = vi.fn();
    render(
      <QuickNotesSection
        files={files}
        onOpenNote={() => undefined}
        onRename={() => undefined}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New quick note' }));
    expect(onCreate).toHaveBeenCalled();
  });

  it('says that the user has no quick note yet', () => {
    render(
      <QuickNotesSection
        files={[]}
        onOpenNote={() => undefined}
        onRename={() => undefined}
        onCreate={() => undefined}
      />,
    );
    expect(screen.getByText('No quick note yet.')).toBeTruthy();
  });
});
