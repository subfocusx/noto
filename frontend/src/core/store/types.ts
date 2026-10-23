// Types of the application state.
//
// The state is plain data so that it can be inspected, serialised and handed
// to a plugin host without touching component internals.
import type { AutosaveStatus } from '../../lib/autosave';
import type { Draft } from '../../lib/drafts';
import type { Node } from '../../types';
import type { ThemePreference } from '../settings/prefs';

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
  /** The total number of the notes of the vault. */
  noteTotal: number;
  /** The total number of the folders of the vault. */
  folderTotal: number;
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
  /** True when the command palette is open. */
  paletteOpen: boolean;
  drawerOpen: boolean;
  /** True when the sidebar is collapsed to its icon rail. */
  sidebarCollapsed: boolean;
  /** The width of the sidebar in pixels. */
  sidebarWidth: number;
  /** The sort order of the tree. */
  treeSort: 'name' | 'modified';
  /** The font size of the editor in pixels. */
  editorFontSize: number;
  /** True when the editor wraps the long lines. */
  editorWrap: boolean;
  /** The paths of the recently opened notes, the newest first. */
  recentPaths: string[];
  /** True when the dialog of the settings is open. */
  settingsOpen: boolean;
  /** True when the dialog of the keyboard shortcuts is open. */
  shortcutHelpOpen: boolean;
  /** The open context menu of the tree. */
  contextMenu: ContextMenuState | null;
  /** True when the right panel (the outline) is visible. */
  rightPanelVisible: boolean;
  /** True when the right panel stays open on narrow screens. */
  rightPanelPinned: boolean;
  /** The width of the right column in pixels. */
  rightPanelWidth: number;
  /** True when the list of the recent notes is collapsed. */
  recentCollapsed: boolean;
  /** True when the tree shows the number of the notes of a folder. */
  treeShowCounts: boolean;
  /** True when the storage of the notes has been chosen. */
  vaultConfigured: boolean;
  /** The path of the storage of the notes. */
  vaultPath: string;
  /** True when the storage cannot be changed at runtime. */
  vaultFixed: boolean;
  /** True while the storage is being read or changed. */
  vaultBusy: boolean;
}

/** The open context menu of the note tree. */
export interface ContextMenuState {
  /** The path of the note or the folder the menu belongs to. */
  path: string;
  /** True when the entry is a folder. */
  isFolder: boolean;
  /** The horizontal position of the menu in pixels. */
  x: number;
  /** The vertical position of the menu in pixels. */
  y: number;
}

/** Browser environment. */
export interface EnvState {
  online: boolean;
  /** The theme the user chose; `system` follows the operating system. */
  theme: ThemePreference;
  /** The theme that is really active. */
  effectiveTheme: 'light' | 'dark';
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
