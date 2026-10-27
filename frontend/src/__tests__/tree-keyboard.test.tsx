import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Sidebar } from '../components/Sidebar';
import { buildTree } from '../lib/tree';
import type { Node } from '../types';

/** A folder of the vault. */
function folder(path: string, name: string): Node {
  return {
    id: path,
    name,
    path,
    type: 'folder',
    parentPath: '',
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    noteCount: 1,
  };
}

/** A note of the vault. */
function note(path: string, name: string, parentPath = ''): Node {
  return {
    id: path,
    name,
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

/**
 * Renders the sidebar with a tree of two folders and two notes.
 *
 * The tree is: `journal` (folded), `archive` (open, with `old.md` inside) and
 * the notes `alpha.md` and `beta.md` in the root.
 */
function renderSidebar(overrides: Record<string, unknown> = {}) {
  const folders = [folder('journal', 'journal'), folder('archive', 'archive')];
  const files = [
    note('alpha.md', 'alpha.md'),
    note('beta.md', 'beta.md'),
    note('archive/old.md', 'old.md', 'archive'),
  ];
  const { roots, filesByParent } = buildTree(folders, files);
  return render(
    <Sidebar
      section="explorer"
      folders={roots}
      filesByParent={filesByParent}
      currentPath=""
      expanded={new Set<string>(['archive'])}
      onToggle={() => undefined}
      onSelect={() => undefined}
      onCreateFolder={() => undefined}
      onCreateFile={() => undefined}
      onRename={() => undefined}
      onMove={() => undefined}
      onDelete={() => undefined}
      onOpenTransfer={() => undefined}
      onRefresh={() => undefined}
      loading={false}
      {...overrides}
    />,
  );
}

/** The name of the row that has the focus. */
function focusedName(): string | null {
  const active = document.activeElement as HTMLElement | null;
  const row = active?.closest('[data-tree-path]') as HTMLElement | null;
  return row?.dataset.treePath ?? null;
}

describe('the keyboard of the tree', () => {
  it('walks the visible rows with the arrow keys', () => {
    renderSidebar();

    const tree = screen.getByTestId('file-tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(focusedName()).toBe('archive');

    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(focusedName()).toBe('archive/old.md');

    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(focusedName()).toBe('journal');

    fireEvent.keyDown(tree, { key: 'ArrowUp' });
    expect(focusedName()).toBe('archive/old.md');
  });

  it('goes to the first and to the last row with Home and End', () => {
    renderSidebar();

    const tree = screen.getByTestId('file-tree');
    fireEvent.keyDown(tree, { key: 'End' });
    expect(focusedName()).toBe('beta.md');

    fireEvent.keyDown(tree, { key: 'Home' });
    expect(focusedName()).toBe('archive');
  });

  it('unfolds a folded folder with the right arrow', () => {
    const onToggle = vi.fn();
    renderSidebar({ onToggle });

    const tree = screen.getByTestId('file-tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(focusedName()).toBe('journal');

    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(onToggle).toHaveBeenCalledWith('journal');
  });

  it('enters an open folder with the right arrow and leaves it with the left one', () => {
    renderSidebar();

    const tree = screen.getByTestId('file-tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(focusedName()).toBe('archive');

    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(focusedName()).toBe('archive/old.md');

    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(focusedName()).toBe('archive');
  });

  it('opens a note with the Enter key', () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelect });

    const tree = screen.getByTestId('file-tree');
    fireEvent.keyDown(tree, { key: 'End' });
    fireEvent.keyDown(tree, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('beta.md');
  });

  it('jumps to the note that starts with the typed letters', () => {
    renderSidebar();

    const tree = screen.getByTestId('file-tree');
    fireEvent.keyDown(tree, { key: 'a' });
    expect(focusedName()).toBe('archive');

    fireEvent.keyDown(tree, { key: 'l' });
    expect(focusedName()).toBe('alpha.md');
  });

  it('keeps one tab stop for the whole tree', () => {
    renderSidebar();

    const buttons = Array.from(
      screen.getByTestId('file-tree').querySelectorAll<HTMLElement>('.tree-row button'),
    );
    const stops = buttons.filter((button) => button.tabIndex === 0);
    expect(stops.length).toBe(1);
  });
});
