// The raw state container of the application store.
//
// It owns the state object, the mutable mirrors that asynchronous callbacks
// need and the subscriber list. The actions (`./actions.ts`) work on top of
// it, the facade (`./appStore.ts`) exposes both to the outside world.
import type { AppState, NoteState } from './types';
import { loadPrefs, type ThemePreference } from '../settings/prefs';

/**
 * Mutable mirrors of the state that asynchronous callbacks need.
 *
 * They used to be `useRef`s inside `App.tsx`; they are written synchronously
 * by the actions, exactly where the refs used to be assigned, so that the
 * semantics of the guards ("is this still the current note?") stay the same.
 */
export interface Refs {
  /** Path of the note that is currently open. */
  currentPath: string | null;
  /** Last known server revision of the open note. */
  revision: number;
  /** Text of the open note. */
  content: string;
  /** Path of the note that is currently being loaded; edits are ignored then. */
  loadingPath: string | null;
}

/**
 * Resolves the theme that is really active.
 *
 * The explicit choice of the user always wins; `system` follows the
 * preference of the operating system.
 */
export function resolveTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
  } catch {
    /* the browser does not support the query */
  }
  return 'dark';
}

function initialTheme(): ThemePreference {
  return loadPrefs().theme;
}

function initialOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function createInitialState(): AppState {
  const prefs = loadPrefs();
  return {
    tree: { folders: [], files: [], loading: true, noteTotal: 0, folderTotal: 0 },
    note: {
      path: null,
      content: '',
      contentPath: null,
      revision: 0,
      status: 'idle',
      dirty: false,
      saveError: null,
    },
    dialog: { kind: null },
    ui: {
      mode: prefs.mode,
      expanded: new Set<string>(prefs.expandedFolders),
      searchOpen: false,
      paletteOpen: false,
      drawerOpen: false,
      sidebarCollapsed: prefs.sidebarCollapsed,
      sidebarWidth: prefs.sidebarWidth,
      treeSort: prefs.treeSort,
      editorFontSize: prefs.editorFontSize,
      editorWrap: prefs.editorWrap,
      recentPaths: [...prefs.recentPaths],
      openPaths: [],
      settingsOpen: false,
      shortcutHelpOpen: false,
      contextMenu: null,
      rightPanelVisible: prefs.rightPanelVisible,
      rightPanelPinned: prefs.rightPanelPinned,
      rightPanelWidth: prefs.rightPanelWidth,
      recentCollapsed: prefs.recentCollapsed,
      treeShowCounts: prefs.treeShowCounts,
      vaultConfigured: false,
      vaultPath: '',
      vaultFixed: false,
      vaultBusy: false,
    },
    env: {
      online: initialOnline(),
      connection: 'connecting',
      theme: initialTheme(),
      effectiveTheme: resolveTheme(initialTheme()),
    },
    draftOffer: null,
    banner: null,
  };
}

export interface Internals {
  state: AppState;
  refs: Refs;
  listeners: Set<() => void>;
}

export const internals: Internals = {
  state: createInitialState(),
  refs: { currentPath: null, revision: 0, content: '', loadingPath: null },
  listeners: new Set(),
};

/** The mutable mirrors; the object identity never changes. */
export const refs: Refs = internals.refs;

/** Applies a recipe to the state and notifies the subscribers. */
export function update(recipe: (prev: AppState) => AppState): void {
  const next = recipe(internals.state);
  if (next === internals.state) return;
  internals.state = next;
  notify();
}

/** Tells every subscriber that the state changed. */
export function notify(): void {
  for (const listener of [...internals.listeners]) listener();
}

/** Patches a part of the note state. */
export function patchNote(patch: Partial<NoteState>): void {
  update((prev) => ({ ...prev, note: { ...prev.note, ...patch } }));
}

/** Subscribes to state changes; returns the unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  internals.listeners.add(listener);
  return () => {
    internals.listeners.delete(listener);
  };
}

/** The current state; the reference changes with every state change. */
export function getSnapshot(): AppState {
  return internals.state;
}

/** Resets the state and the mirrors to their initial values. */
export function resetState(): void {
  internals.state = createInitialState();
  refs.currentPath = null;
  refs.revision = 0;
  refs.content = '';
  refs.loadingPath = null;
}
