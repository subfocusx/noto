import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { Sidebar } from '../components/Sidebar';
import { buildTree } from '../lib/tree';
import type { Node } from '../types';

function file(path: string, name: string, parentPath: string): Node {
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

function folder(path: string, name: string, parentPath: string): Node {
  return {
    id: path,
    name,
    path,
    type: 'folder',
    parentPath,
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

describe('tree building', () => {
  it('nests folders and groups files by parent', () => {
    const folders = [folder('journal', 'journal', ''), folder('journal/2026', '2026', 'journal')];
    const files = [
      file('root.md', 'root.md', ''),
      file('journal/a.md', 'a.md', 'journal'),
      file('journal/2026/b.md', 'b.md', 'journal/2026'),
    ];
    const { roots, filesByParent } = buildTree(folders, files);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.node.name).toBe('journal');
    expect(roots[0]?.children[0]?.node.name).toBe('2026');
    expect(filesByParent.get('')?.map((f) => f.name)).toEqual(['root.md']);
    expect(filesByParent.get('journal')?.map((f) => f.name)).toEqual(['a.md']);
    expect(filesByParent.get('journal/2026')?.map((f) => f.name)).toEqual(['b.md']);
  });

  it('sorts every level of the tree by name', () => {
    const folders = [
      folder('journal', 'journal', ''),
      folder('journal/2026', '2026', 'journal'),
      folder('journal/archive', 'archive', 'journal'),
      folder('zeta', 'zeta', ''),
    ];
    const { roots } = buildTree(folders, []);
    expect(roots.map((r) => r.node.name)).toEqual(['journal', 'zeta']);
    expect(roots[0]?.children.map((c) => c.node.name)).toEqual(['2026', 'archive']);
  });
});

describe('sidebar navigation', () => {
  it('selects a file and toggles folders', () => {
    const folders = [folder('journal', 'journal', '')];
    const files = [file('journal/a.md', 'a.md', 'journal')];
    const { roots, filesByParent } = buildTree(folders, files);
    const onSelect = vi.fn();
    const onToggle = vi.fn();

    const view = render(
      <Sidebar
        folders={roots}
        filesByParent={filesByParent}
        currentPath="journal/a.md"
        expanded={new Set(['journal'])}
        onToggle={onToggle}
        onSelect={onSelect}
        onCreateFolder={() => undefined}
        onCreateFile={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onOpenTrash={() => undefined}
        onOpenSearch={() => undefined}
        onOpenTransfer={() => undefined}
        onRefresh={() => undefined}
        loading={false}
      />,
    );

    fireEvent.click(view.getByText('a.md'));
    expect(onSelect).toHaveBeenCalledWith('journal/a.md');

    fireEvent.click(view.getByLabelText('Collapse journal'));
    expect(onToggle).toHaveBeenCalledWith('journal');
  });

  it('hides the files of a collapsed folder', () => {
    const folders = [folder('journal', 'journal', '')];
    const files = [file('journal/a.md', 'a.md', 'journal')];
    const { roots, filesByParent } = buildTree(folders, files);
    const view = render(
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
        onOpenSearch={() => undefined}
        onOpenTransfer={() => undefined}
        onRefresh={() => undefined}
        loading={false}
      />,
    );
    expect(view.queryByText('a.md')).toBeNull();
  });
});
