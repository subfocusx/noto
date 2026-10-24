// Mirrors backend/internal/model/model.go (frozen contract).

export type NodeType = 'file' | 'folder';

export interface Node {
  id: string;
  name: string;
  path: string;
  type: NodeType;
  parentPath: string;
  size: number;
  modTime: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** The number of the notes under the folder (counted recursively). */
  noteCount?: number;
  /** The number of the direct child folders of the folder. */
  folderCount?: number;
}

export interface NoteContent {
  path: string;
  content: string;
  revision: number;
  updatedAt: string;
  conflict: boolean;
}

export interface SearchHit {
  path: string;
  name: string;
  kind: 'name' | 'content' | string;
  snippet: string;
}

/** A tag of the vault and the number of the notes that carry it. */
export interface TagCount {
  tag: string;
  count: number;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  notePath?: string;
  createdAt: string;
}

export interface ImportResult {
  imported: string[];
  skipped: string[];
  errors: string[];
}

export interface TreeResponse {
  folders: Node[];
  files: Node[];
  /** The total number of the notes of the tree. */
  noteTotal?: number;
  /** The total number of the folders of the tree. */
  folderTotal?: number;
}

export interface TrashResponse {
  entries: Node[];
}

export interface SearchResponse {
  hits: SearchHit[];
}

export interface HealthResponse {
  status: string;
  version: string;
  time: string;
}

export interface SaveNoteResponse {
  path: string;
  revision: number;
  updatedAt: string;
}

export type ConflictPolicy = 'skip' | 'rename' | 'overwrite';

/**
 * The state of the connection between the interface and the backend.
 *
 * The indicator of the sidebar shows it at a glance: the user must know
 * whether the changes reach the disk without opening a dialog.
 *
 * The definition lives in the core, next to the monitor that measures it; the
 * re-export keeps the type reachable from the whole application without
 * duplicating it.
 */
export type { ConnectionState } from './core/connection/types';
