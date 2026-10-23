// Builds a nested tree from the flat folder/file arrays of GET /api/tree.
import type { Node, NodeType } from '../types';
import { compareStrings } from './utils';

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
 * Groups the flat node lists into folders (top level + nested) and files.
 * Files are returned per parent path so a folder can render its own files.
 */
export function buildTree(folders: Node[], files: Node[]): {
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
    list.sort((a, b) => compareStrings(a.name, b.name));
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
  // Every level is sorted by name, not only the root level.
  for (const entry of byPath.values()) {
    entry.children.sort((a, b) => compareStrings(a.node.name, b.node.name));
  }
  roots.sort((a, b) => compareStrings(a.node.name, b.node.name));
  return { roots, filesByParent };
}

/** All folder paths, used by the "move to" dialog. */
export function allFolderPaths(folders: Node[]): string[] {
  return folders
    .map((f) => f.path)
    .sort((a, b) => compareStrings(a, b));
}

export function nodeTypeOf(node: Node): NodeType {
  return node.type;
}
