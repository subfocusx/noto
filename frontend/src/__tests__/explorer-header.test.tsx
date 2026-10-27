import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Sidebar } from '../components/Sidebar';
import { buildTree } from '../lib/tree';
import type { Node } from '../types';

/** A folder of the vault, with the number of its notes. */
function folder(path: string, name: string, noteCount: number): Node {
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
    noteCount,
  };
}

/** Renders the sidebar with the actions of the explorer. */
function renderSidebar(overrides: Record<string, unknown> = {}) {
  const folders = [folder('journal', 'journal', 3)];
  const { roots, filesByParent } = buildTree(folders, []);
  return render(
    <Sidebar
      section="explorer"
      folders={roots}
      filesByParent={filesByParent}
      currentPath=""
      expanded={new Set<string>()}
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
      folderTotal={4}
      noteTotal={12}
      {...overrides}
    />,
  );
}

/** Opens the menu of the actions of the explorer. */
function openActions(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Explorer actions' }));
}

describe('the header of the explorer', () => {
  it('has no title of its own: the name of the storage is the title', () => {
    renderSidebar();

    expect(screen.queryByText('Explorer')).toBeNull();
  });

  it('holds no search of its own: the search is a section of the rail', () => {
    renderSidebar();

    expect(screen.queryByRole('button', { name: 'Search notes' })).toBeNull();
  });

  it('shows no counter of the totals', () => {
    renderSidebar();

    const header = screen.getByText('Noto').closest('.vault-header');
    expect(header?.querySelector('.sidebar-section-counts')).toBeNull();
    expect(header?.querySelector('.tree-count')).toBeNull();
  });

  it('keeps the counter of a folder of the tree', () => {
    renderSidebar();

    const row = screen.getByText('journal').closest('.tree-row');
    expect(row?.querySelector('.tree-count')?.textContent).toBe('3');
  });

  it('keeps the actions of the tree on the face of the column', () => {
    renderSidebar();

    // The actions of the tree are visible: they are the actions of the tree
    // itself, and a tree that hides the way to make a folder is a tree the
    // user must guess.
    for (const name of [
      'Expand all folders',
      'Collapse all folders',
      'New folder',
      'Refresh tree',
      'Archive',
      'Open command palette',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('keeps the rest of the vault in the menu of the header', () => {
    renderSidebar();

    // The graph and the plugins are not on the face of the column: they live
    // in the menu.
    expect(screen.queryByRole('button', { name: 'Graph' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Plugins' })).toBeNull();

    openActions();

    for (const name of ['Graph', 'Plugins']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('offers the graph and the archive as real views', () => {
    renderSidebar();

    // The archive stands in the strip of the actions: it is a real view, not
    // a grey button.
    const archive = screen.getByRole('button', { name: 'Archive' });
    expect(archive.getAttribute('aria-disabled')).toBeNull();

    openActions();
    const graph = screen.getByRole('button', { name: 'Graph' });
    expect(graph.getAttribute('aria-disabled')).toBeNull();
    expect(graph.getAttribute('title')).toBeNull();
  });

  it('calls the handlers of the actions', () => {
    const onOpenPalette = vi.fn();
    const onOpenPlugins = vi.fn();
    const onCreateFolder = vi.fn();
    const onRefresh = vi.fn();
    renderSidebar({ onOpenPalette, onOpenPlugins, onCreateFolder, onRefresh });

    // The palette of the commands stands in the strip of the actions.
    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    expect(onOpenPalette).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(onCreateFolder).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh tree' }));
    expect(onRefresh).toHaveBeenCalled();

    // The plugins live in the menu: the user opens it for them.
    openActions();
    fireEvent.click(screen.getByRole('button', { name: 'Plugins' }));
    expect(onOpenPlugins).toHaveBeenCalled();
  });
});
