// The visible rows of the tree, in the order they are drawn.
//
// The tree is drawn recursively, but the keyboard walks a flat list: the arrow
// keys of the tree of a file manager move from one visible row to the next
// one, and the next row of a folder is the first row of its first child.
//
// The list is built here and not in the component, so the order of the rows is
// a fact of the library and not a fact of the rendering.

import type { Node } from '../types';
import type { TreeFolder } from './tree';

/** The kind of a row of the tree. */
export type TreeRowKind = 'folder' | 'note';

/** One visible row of the tree. */
export interface TreeRow {
  /** The path of the node of the row. */
  path: string;
  /** The kind of the node: a folder holds notes, a note is a file. */
  kind: TreeRowKind;
  /** The name of the node, without its path. */
  name: string;
  /** The depth of the row in the tree; the rows of the root are at 0. */
  depth: number;
}

/**
 * The visible rows of the tree, in the order of the drawing.
 *
 * The order is the one of the tree: the folders first, the notes of a folder
 * after the subfolders of that folder, and the notes of the root at the end.
 */
export function flattenTreeRows(
  folders: TreeFolder[],
  rootFiles: Node[],
  filesByParent: Map<string, Node[]>,
  expanded: Set<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (list: TreeFolder[], depth: number): void => {
    for (const folder of list) {
      rows.push({
        path: folder.node.path,
        kind: 'folder',
        name: folder.node.name,
        depth,
      });
      if (!expanded.has(folder.node.path)) continue;
      walk(folder.children, depth + 1);
      for (const file of filesByParent.get(folder.node.path) ?? []) {
        rows.push({ path: file.path, kind: 'note', name: file.name, depth: depth + 1 });
      }
    }
  };
  walk(folders, 0);
  for (const file of rootFiles) {
    rows.push({ path: file.path, kind: 'note', name: file.name, depth: 0 });
  }
  return rows;
}

/**
 * The index of the row of a path.
 *
 * Returns -1 when the path is not visible: a note that is hidden by the
 * filter of the user cannot be reached with the arrow keys.
 */
export function indexOfRow(rows: TreeRow[], path: string | null): number {
  if (path === null) return -1;
  return rows.findIndex((row) => row.path === path);
}

/**
 * The index of the parent of a row.
 *
 * The rows of a tree are drawn in the depth-first order, so the parent of a
 * row is the last row before it that is one level higher.
 */
export function parentRowIndex(rows: TreeRow[], index: number): number {
  const row = rows[index];
  if (!row || row.depth === 0) return -1;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (rows[i].depth === row.depth - 1) return i;
  }
  return -1;
}

/**
 * The index of the first row that starts with the given letters.
 *
 * The search starts after the current row and wraps around, so a letter that
 * is typed twice walks through the notes that start with it. The comparison
 * ignores the case: the user types what they see.
 */
export function findRowByPrefix(rows: TreeRow[], prefix: string, fromIndex: number): number {
  if (prefix.length === 0) return -1;
  const needle = prefix.toLowerCase();
  for (let step = 1; step <= rows.length; step += 1) {
    const index = (fromIndex + step) % rows.length;
    if (rows[index].name.toLowerCase().startsWith(needle)) return index;
  }
  return -1;
}
