// The tests of the panel of the archive.
//
// The archive lists the notes the tree cannot show and gives them the usual
// actions: open, rename and delete.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { ArchivePanel } from '../components/sections/ArchivePanel';
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

const files = [file('a.md'), file('lost/c.md', 'lost')];

/** The panel of the archive, with the props of the tests. */
function renderPanel() {
  const onOpenNote = vi.fn();
  const onRename = vi.fn();
  const onDelete = vi.fn();
  render(
    <ArchivePanel
      files={files}
      folders={[]}
      onOpenNote={onOpenNote}
      onRename={onRename}
      onDelete={onDelete}
    />,
  );
  return { onOpenNote, onRename, onDelete };
}

describe('the panel of the archive', () => {
  it('lists the notes the tree cannot show', () => {
    renderPanel();
    expect(screen.getByText('c.md')).toBeTruthy();
    expect(screen.getByText('lost/c.md')).toBeTruthy();
  });

  it('does not list the notes of the tree', () => {
    renderPanel();
    expect(screen.queryByText('a.md')).toBeNull();
  });

  it('opens the note the user chooses', () => {
    const { onOpenNote } = renderPanel();
    fireEvent.click(screen.getByText('c.md'));
    expect(onOpenNote).toHaveBeenCalledWith('lost/c.md');
  });

  it('renames the note the user chooses', () => {
    const { onRename } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Rename c.md' }));
    expect(onRename).toHaveBeenCalledWith(files[1]);
  });

  it('deletes the note the user chooses', () => {
    const { onDelete } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Delete c.md' }));
    expect(onDelete).toHaveBeenCalledWith(files[1]);
  });

  it('says that every note is in the tree', () => {
    render(<ArchivePanel files={[file('a.md')]} folders={[]} onOpenNote={() => undefined} onRename={() => undefined} onDelete={() => undefined} />);
    expect(screen.getByText('Every note of the vault is in the tree.')).toBeTruthy();
  });
});
