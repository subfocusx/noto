import { describe, expect, it } from 'vitest';
import { buildTree } from '../lib/tree';
import type { Node } from '../types';

function node(path: string, name: string, parentPath: string, type: 'file' | 'folder', updatedAt = ''): Node {
  return {
    id: path,
    name,
    path,
    type,
    parentPath,
    size: 0,
    modTime: updatedAt,
    revision: 1,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('the sort order of the tree', () => {
  const folders = [
    node('journal', 'journal', '', 'folder', '2026-01-01T00:00:00Z'),
    node('zeta', 'zeta', '', 'folder', '2026-02-01T00:00:00Z'),
  ];
  const files = [
    node('b.md', 'b.md', '', 'file', '2026-01-02T00:00:00Z'),
    node('a.md', 'a.md', '', 'file', '2026-03-01T00:00:00Z'),
    node('journal/inner.md', 'inner.md', 'journal', 'file', '2026-01-03T00:00:00Z'),
  ];

  it('sorts by name by default', () => {
    const { roots, filesByParent } = buildTree(folders, files);
    expect(roots.map((folder) => folder.node.name)).toEqual(['journal', 'zeta']);
    expect(filesByParent.get('')?.map((file) => file.name)).toEqual(['a.md', 'b.md']);
  });

  it('puts the recently changed notes first when the sort is by date', () => {
    const { roots, filesByParent } = buildTree(folders, files, 'modified');
    expect(filesByParent.get('')?.map((file) => file.name)).toEqual(['a.md', 'b.md']);
    // The folders are always listed before the notes, even when they are older.
    expect(roots.map((folder) => folder.node.name)).toEqual(['zeta', 'journal']);
  });

  it('falls back to the name when two notes have the same date', () => {
    const same = [
      node('b.md', 'b.md', '', 'file', '2026-01-01T00:00:00Z'),
      node('a.md', 'a.md', '', 'file', '2026-01-01T00:00:00Z'),
    ];
    const { filesByParent } = buildTree([], same, 'modified');
    expect(filesByParent.get('')?.map((file) => file.name)).toEqual(['a.md', 'b.md']);
  });

  it('does not change the grouping of the notes', () => {
    const { filesByParent } = buildTree(folders, files, 'modified');
    expect(filesByParent.get('journal')?.map((file) => file.name)).toEqual(['inner.md']);
  });
});
