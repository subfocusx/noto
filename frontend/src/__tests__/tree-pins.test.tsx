// The tests of the pins in the tree.
//
// The pinned notes stand at the top of the tree, in the order the user pinned
// them. The button of the pin lives on the row of the note, and the menu of
// the row carries the same action.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { ExplorerSection } from '../components/sections/ExplorerSection';
import { TreeContextMenu } from '../components/TreeContextMenu';
import { setPins } from '../core/pin/pins';
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

const files = [file('a.md'), file('b.md')];

/** The explorer of the tests. */
function renderExplorer() {
  const props = {
    folders: [],
    filesByParent: new Map<string, Node[]>([['', files]]),
    currentPath: '',
    expanded: new Set<string>(),
    loading: false,
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onCreateFolder: vi.fn(),
    onCreateFile: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
    onRefresh: vi.fn(),
  };
  const view = render(<ExplorerSection {...props} />);
  return { ...props, container: view.container };
}

/** The menu of a note of the tree. */
function renderMenu(path: string) {
  return render(
    <TreeContextMenu
      path={path}
      isFolder={false}
      x={10}
      y={10}
      onClose={() => undefined}
      onRename={() => undefined}
      onMove={() => undefined}
      onDelete={() => undefined}
      onCreateFile={() => undefined}
      onCreateFolder={() => undefined}
    />,
  );
}

afterEach(() => {
  localStorage.clear();
  setPins([]);
  vi.restoreAllMocks();
});

describe('the pins in the tree', () => {
  it('shows no group of pins when nothing is pinned', () => {
    const { container } = renderExplorer();
    expect(container.querySelector('.tree-pinned')).toBeNull();
  });

  it('pins the note the user chooses', () => {
    renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: 'Pin a.md' }));
    expect(screen.getAllByRole('button', { name: 'Unpin a.md' }).length).toBeGreaterThan(0);
  });

  it('shows the pinned note at the top of the tree', () => {
    const { container } = renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: 'Pin b.md' }));
    const group = container.querySelector('.tree-pinned');
    expect(group).toBeTruthy();
    expect(group?.textContent).toContain('b.md');
  });

  it('keeps the order of the pins', () => {
    const { container } = renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: 'Pin b.md' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pin a.md' }));
    const group = container.querySelector('.tree-pinned');
    const rows = group?.querySelectorAll('.tree-name') ?? [];
    expect([...rows].map((row) => row.textContent)).toEqual(['b.md', 'a.md']);
  });

  it('unpins the note when the user asks for it', () => {
    const { container } = renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: 'Pin a.md' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Unpin a.md' })[0] as Element);
    expect(container.querySelector('.tree-pinned')).toBeNull();
  });

  it('pins a note from the menu of the row', () => {
    renderMenu('a.md');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin the note' }));
    expect(screen.getByRole('menuitem', { name: 'Unpin the note' })).toBeTruthy();
  });
});
