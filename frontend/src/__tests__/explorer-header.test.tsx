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
      onOpenTrash={() => undefined}
      onOpenTransfer={() => undefined}
      onRefresh={() => undefined}
      loading={false}
      folderTotal={4}
      noteTotal={12}
      {...overrides}
    />,
  );
}

describe('the header of the explorer', () => {
  it('holds the actions of the vault', () => {
    renderSidebar();

    const title = screen.getByText('Explorer').closest('.sidebar-section-title');
    expect(title).not.toBeNull();

    for (const name of ['Search notes', 'Graph', 'Archive', 'Open command palette', 'Plugins']) {
      const button = screen.getByRole('button', { name });
      expect(title?.contains(button)).toBe(true);
    }
  });

  it('holds the indicator of the connection', () => {
    renderSidebar({ connection: 'connected' });

    const title = screen.getByText('Explorer').closest('.sidebar-section-title');
    const indicator = title?.querySelector('.conn-dot');
    expect(indicator).not.toBeNull();
    expect(indicator?.getAttribute('aria-label')).toBe('Backend connected');
  });

  it('shows no counter of the totals', () => {
    renderSidebar();

    const title = screen.getByText('Explorer').closest('.sidebar-section-title');
    expect(title?.querySelector('.sidebar-section-counts')).toBeNull();
    expect(title?.querySelector('.tree-count')).toBeNull();
  });

  it('keeps the counter of a folder of the tree', () => {
    renderSidebar();

    const row = screen.getByText('journal').closest('.tree-row');
    expect(row?.querySelector('.tree-count')?.textContent).toBe('3');
  });

  it('marks the graph and the archive as not implemented', () => {
    renderSidebar();

    const graph = screen.getByRole('button', { name: 'Graph' });
    expect(graph.getAttribute('aria-disabled')).toBe('true');
    expect(graph.getAttribute('title')).toBe('Not implemented yet');

    const archive = screen.getByRole('button', { name: 'Archive' });
    expect(archive.getAttribute('aria-disabled')).toBe('true');
    expect(archive.getAttribute('title')).toBe('Not implemented yet');
  });

  it('calls the handlers of the actions', () => {
    const onOpenSearch = vi.fn();
    const onOpenPalette = vi.fn();
    const onOpenPlugins = vi.fn();
    renderSidebar({ onOpenSearch, onOpenPalette, onOpenPlugins });

    fireEvent.click(screen.getByRole('button', { name: 'Search notes' }));
    expect(onOpenSearch).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    expect(onOpenPalette).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Plugins' }));
    expect(onOpenPlugins).toHaveBeenCalled();
  });
});
