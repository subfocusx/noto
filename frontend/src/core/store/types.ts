// Types of the application state.
//
// The state is plain data so that it can be inspected, serialised and handed
// to a plugin host without touching component internals.
import type { AutosaveStatus } from '../../lib/autosave';
import type { Draft } from '../../lib/drafts';
import type { Node, SearchHit, TagCount } from '../../types';
import type { ThemePreference } from '../settings/prefs';
import type { ConnectionState } from '../connection/types';
import type { Notification } from '../notifications/types';
import type { Reminder } from '../reminders/types';

/**
 * The mode of the note that is open.
 *
 * The note is either edited or read: the pane of the editor shows one of the
 * two, and the pencil of the strip of the tabs switches between them. There is
 * no third mode: two windows for one note were one window too many.
 */
export type ViewMode = 'edit' | 'view';

/**
 * The section of the left column that the rail shows.
 *
 * The rail of the sections is an accordion: exactly one section is open at a
 * time, and the choice survives a reload.
 */
export type RailSection =
  | 'explorer'
  | 'favorites'
  | 'calendar'
  | 'search'
  | 'filters'
  | 'history'
  | 'notifications'
  | 'trash';

/**
 * The module of the window of the search.
 *
 * The window has two modules: the search of the text and the filter of the
 * query language. The mode says which one the window shows.
 */
export type FindMode = 'search' | 'filters';

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

/**
 * True when the dialog asks for a name.
 *
 * A name is never optional: the dialogs of the creation and of the renaming
 * refuse an empty name instead of creating a note without a name.
 */
export function asksForName(kind: DialogKind): boolean {
  return kind === 'create-folder' || kind === 'create-file' || kind === 'rename';
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
/**
 * A conflict of a note: the note on the server is not the note in the editor.
 *
 * The conflict appears when the note was changed outside of the application
 * (another editor, another tab, a script). The user decides what happens: take
 * the version of the server, keep the version of the editor or copy it.
 */
export interface NoteConflict {
  /** The path of the note. */
  path: string;
  /** The content of the note on the server. */
  serverContent: string;
  /** The revision of the note on the server. */
  serverRevision: number;
  /** The moment of the last change on the server (ISO 8601). */
  serverUpdatedAt: string;
}

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
  /** The conflict of the note (`null` when there is none). */
  conflict: NoteConflict | null;
}

/** Purely visual state. */
export interface UiState {
  mode: ViewMode;
  expanded: Set<string>;
  /**
   * True when the window of the search and the filters is open.
   *
   * The window lives over the application: the column of the explorer keeps the
   * tree, and the window answers the question "which note do I look for?" in
   * two modes.
   */
  findOpen: boolean;
  /** The module of the window that is open. */
  findMode: FindMode;
  /** True when the command palette is open. */
  paletteOpen: boolean;
  drawerOpen: boolean;
  /**
   * The section of the left column that is open.
   *
   * The column always shows one of the sections of the rail; the rail itself
   * never disappears, so the section is the only thing that changes.
   */
  railSection: RailSection;
  /**
   * The month the calendar shows, as `YYYY-MM`.
   *
   * The empty string means "the month of today": the calendar shows it until
   * the user walks to another month.
   */
  calendarMonth: string;
  /**
   * The day the user selected in the calendar, as `YYYY-MM-DD`.
   *
   * `null` means that no day is selected.
   */
  calendarDay: string | null;
  /**
   * The notifications of the user, the newest first.
   *
   * The list lives in the store and in `localStorage`, so the rail, the section
   * of the notifications and the plugins always see the same list — and the
   * list survives a reload of the page.
   */
  notifications: Notification[];
  /**
   * The paths of the notes the user marked as favorites.
   *
   * The list lives in the store and in `localStorage`: a favorite is a mark of
   * the interface, and it must survive a reload of the page.
   */
  favorites: string[];
  /**
   * The reminders of the user, the newest first.
   *
   * A reminder is a moment the user asked to be told about; when it comes the
   * application writes a notification and shows a system notification.
   */
  reminders: Reminder[];
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
  /**
   * The paths of the notes that are open in the tab strip of the editor.
   *
   * The strip lives in the store and not in a component: a note can be opened
   * by the tree, by the search, by a plugin or by the dialog of a new note,
   * and every one of these paths must show the note in the strip.
   */
  openPaths: string[];
  /**
   * The active query of the query language.
   *
   * The query lives in the store, and not in a component: the same selection
   * must be seen by the search panel, by the tree, by the saved views and by
   * the plugins.
   */
  query: string;
  /** The notes that match the active query. */
  queryHits: SearchHit[];
  /** The total number of the matching notes. */
  queryTotal: number;
  /**
   * True when the properties of some notes could not be recalculated, so the
   * answer of the query may be incomplete.
   */
  queryPartial: boolean;
  /** The message of the last failed query. */
  queryError: string | null;
  /** The tags of the vault with the number of the notes that carry them. */
  tags: TagCount[];
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
  /**
   * The panel of the right column that is open.
   *
   * The core of the application (the outline of the note) and the panels of
   * the plugins are peers: one strip of tabs chooses which one is shown, so
   * the column never mixes the core with the plugins.
   */
  rightPanelTab: string;
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
  /**
   * The paths of the storages that were opened before, the newest first.
   *
   * The list is the quick way back to a storage: it is shown by the menu of
   * the header of the storage.
   */
  vaultRecents: string[];
  /**
   * The paths of the storages that are open at the same time.
   *
   * The storages keep their own tree and their own open note, so the user can
   * walk from one storage to another without losing his place. The active
   * storage comes first.
   */
  openStorages: string[];
  /** True when the quick menu of the storage is open. */
  vaultMenuOpen: boolean;
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
  /**
   * The state of the connection with the Noto backend.
   *
   * `online` tells whether the browser itself has a network; `connection`
   * tells whether the backend answers. A browser can be online while the
   * backend is down, and the user must be able to tell the two apart.
   */
  connection: ConnectionState;
  /** The theme the user chose; `system` follows the operating system. */
  theme: ThemePreference;
  /** The theme that is really active. */
  effectiveTheme: 'light' | 'dark';
  /**
   * The number of the writes that wait for the connection.
   *
   * A write that failed because the server was unreachable goes into the
   * outbox of the browser and is replayed when the connection comes back.
   */
  pendingSync: number;
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
