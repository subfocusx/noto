// Types of the application state.
//
// The state is plain data so that it can be inspected, serialised and handed
// to a plugin host without touching component internals.
import type { AutosaveStatus } from '../../lib/autosave';
import type { Draft } from '../../lib/drafts';
import type { Node } from '../../types';

export type ViewMode = 'editor' | 'split' | 'preview';

export type DialogKind =
  | null
  | 'create-folder'
  | 'create-file'
  | 'rename'
  | 'move'
  | 'delete'
  | 'trash'
  | 'transfer'
  | 'attachments';

export interface DialogState {
  kind: DialogKind;
  node?: Node;
  parentPath?: string;
  value?: string;
}

/** The folder/file tree of the workspace. */
export interface TreeState {
  folders: Node[];
  files: Node[];
  loading: boolean;
}

/** The note that is currently open. */
export interface NoteState {
  /** Path of the open note (`null` when nothing is open). */
  path: string | null;
  /** Text of the open note. */
  content: string;
  /** Path the loaded content belongs to (`null` while loading). */
  contentPath: string | null;
  /** Last known server revision. */
  revision: number;
  /** Autosave status. */
  status: AutosaveStatus;
  /** True while there are unsaved changes. */
  dirty: boolean;
  /** Message of the last failed save. */
  saveError: string | null;
}

/** Purely visual state. */
export interface UiState {
  mode: ViewMode;
  expanded: Set<string>;
  searchOpen: boolean;
  drawerOpen: boolean;
}

/** Browser environment. */
export interface EnvState {
  online: boolean;
  theme: 'light' | 'dark';
}

/** The complete application state. */
export interface AppState {
  tree: TreeState;
  note: NoteState;
  dialog: DialogState;
  ui: UiState;
  env: EnvState;
  /** A newer local draft that can be recovered. */
  draftOffer: Draft | null;
  /** Message of the global error banner. */
  banner: string | null;
}
