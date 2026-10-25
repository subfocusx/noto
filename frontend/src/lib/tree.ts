// Builds a nested tree from the flat folder/file arrays of GET /api/tree.
import type { Node, NodeType } from '../types';
import { compareStrings } from './ordering';

export interface TreeNode {
  node: Node;
  children: TreeNode[];
}

export interface TreeFolder {
  node: Node;
  children: TreeNode[];
}

export function parentPathOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

export function baseNameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * The sort order of the tree.
 *
 * `name` sorts the entries alphabetically, `modified` puts the recently
 * changed notes first. The folders are always listed before the notes.
 */
export type TreeSort = 'name' | 'modified';

function compareBySort(a: Node, b: Node, sort: TreeSort): number {
  if (sort === 'modified') {
    // The timestamps are ISO strings, so a plain comparison is enough.
    const byTime = b.updatedAt.localeCompare(a.updatedAt);
    if (byTime !== 0) return byTime;
  }
  return compareStrings(a.name, b.name);
}

/**
 * Groups the flat node lists into folders (top level + nested) and files.
 * Files are returned per parent path so a folder can render its own files.
 */
export function buildTree(
  folders: Node[],
  files: Node[],
  sort: TreeSort = 'name',
): {
  roots: TreeFolder[];
  filesByParent: Map<string, Node[]>;
} {
  const filesByParent = new Map<string, Node[]>();
  for (const file of files) {
    const list = filesByParent.get(file.parentPath) ?? [];
    list.push(file);
    filesByParent.set(file.parentPath, list);
  }
  for (const list of filesByParent.values()) {
    list.sort((a, b) => compareBySort(a, b, sort));
  }

  const byPath = new Map<string, TreeFolder>();
  for (const folder of folders) {
    byPath.set(folder.path, { node: folder, children: [] });
  }

  const roots: TreeFolder[] = [];
  // Link every folder into its parent; the children array is shared by
  // reference so deeper levels added later are visible.
  for (const folder of folders) {
    const entry = byPath.get(folder.path)!;
    const parent = byPath.get(folder.parentPath);
    if (parent) parent.children.push({ node: folder, children: entry.children });
    else roots.push(entry);
  }
  // Every level is sorted, not only the root level.
  for (const entry of byPath.values()) {
    entry.children.sort((a, b) => compareBySort(a.node, b.node, sort));
  }
  roots.sort((a, b) => compareBySort(a.node, b.node, sort));
  return { roots, filesByParent };
}

/** All folder paths, used by the "move to" dialog. */
export function allFolderPaths(folders: Node[]): string[] {
  return folders
    .map((f) => f.path)
    .sort((a, b) => compareStrings(a, b));
}

/**
 * Keeps only the notes of the filter and the folders that hold them.
 *
 * A folder stays when it holds a matching note, directly or in one of its
 * subfolders: the tree of a filtered vault keeps its shape, so the user sees
 * where the matching notes live.
 */
export function filterTree(
  roots: TreeFolder[],
  filesByParent: Map<string, Node[]>,
  allowed: Set<string>,
): { folders: TreeFolder[]; filesByParent: Map<string, Node[]> } {
  const filteredFiles = new Map<string, Node[]>();
  for (const [parent, files] of filesByParent) {
    const kept = files.filter((file) => allowed.has(file.path));
    if (kept.length > 0) filteredFiles.set(parent, kept);
  }

  const keep = (folder: TreeFolder): TreeFolder | null => {
    const children = folder.children
      .map((child) => keep(child))
      .filter((child): child is TreeFolder => child !== null);
    const hasFiles = (filteredFiles.get(folder.node.path) ?? []).length > 0;
    if (children.length === 0 && !hasFiles) return null;
    return { node: folder.node, children };
  };

  const filteredRoots = roots
    .map((folder) => keep(folder))
    .filter((folder): folder is TreeFolder => folder !== null);

  return { folders: filteredRoots, filesByParent: filteredFiles };
}

export function nodeTypeOf(node: Node): NodeType {
  return node.type;
}

/**
 * The reason why a node cannot be moved into a folder.
 *
 * `into-itself`: the folder would land inside itself. `already-there`: the
 * node already lives in that folder. `null`: the move is possible.
 */
export type MoveRefusal = 'into-itself' | 'already-there' | null;

/**
 * Tells whether a node may be moved into a folder, and why it may not.
 *
 * The rules are the ones of the server: a folder cannot be moved into itself
 * or into one of its own descendants, and a node cannot be moved into the
 * folder it already lives in. The rule lives here, once: the row of the tree
 * (which shows the answer before the drop) and the explorer (which refuses
 * the move) ask the same question, so they cannot disagree.
 */
export function refusalOfMove(node: Node, targetParentPath: string): MoveRefusal {
  if (node.type === 'folder') {
    if (targetParentPath === node.path) return 'into-itself';
    if (targetParentPath.startsWith(`${node.path}/`)) return 'into-itself';
  }
  if (parentPathOf(node.path) === targetParentPath) return 'already-there';
  return null;
}

/** Tells whether a node may be moved into a folder. */
export function canMoveInto(node: Node, targetParentPath: string): boolean {
  return refusalOfMove(node, targetParentPath) === null;
}
