// The state of one storage of the notes.
//
// The application works with one storage at a time, but the user may keep
// several of them open at the same time (the way SiYuan keeps several
// workspaces). Every storage owns its tree, its open note and its own view of
// the folders; the state of the storage that is active is published to the
// store, the states of the others wait in the registry
// (`./storageRegistry.ts`).
//
// The module is pure: it takes a state and gives a state back. The store
// (`../store/state.ts`) keeps the single active state, the registry keeps the
// others.
import type { AppState, NoteState, TreeState } from '../store/types';

/**
 * The mirrors of the store that the asynchronous callbacks need.
 *
 * They live in the state of the storage as well: a callback that belongs to a
 * storage must not see the note of another one.
 */
export interface StorageMirrors {
  /** Path of the note that is currently open. */
  currentPath: string | null;
  /** Last known server revision of the open note. */
  revision: number;
  /** Text of the open note. */
  content: string;
  /** Path of the note that is currently being loaded. */
  loadingPath: string | null;
}

/** The state of one storage of the notes. */
export interface StorageState {
  /** The path of the storage on the disk. */
  path: string;
  /** The tree of the notes of the storage. */
  tree: TreeState;
  /** The note that is open in the storage. */
  note: NoteState;
  /** The folders that are open in the tree. */
  expanded: Set<string>;
  /** The notes that are open in the tab strip. */
  openPaths: string[];
  /** The notes that were opened recently in the storage. */
  recentPaths: string[];
  /** The mirrors of the store. */
  mirrors: StorageMirrors;
}

/**
 * The key of a storage.
 *
 * The key is the path of the storage, cut at the end and folded: two paths
 * that differ only in the case or in the last separator are the same storage.
 */
export function storageKey(path: string): string {
  return path.trim().replace(/[\\/]+$/, '').toLowerCase();
}

/** The state of a storage that was never opened. */
export function emptyStorageState(path: string): StorageState {
  return {
    path,
    tree: { folders: [], files: [], loading: true, noteTotal: 0, folderTotal: 0 },
    note: {
      path: null,
      content: '',
      contentPath: null,
      revision: 0,
      status: 'idle',
      dirty: false,
      saveError: null,
      conflict: null,
    },
    expanded: new Set<string>(),
    openPaths: [],
    recentPaths: [],
    mirrors: { currentPath: null, revision: 0, content: '', loadingPath: null },
  };
}

/**
 * Reads the state of the storage that is active out of the state of the store.
 *
 * The tree, the note and the folders are taken by reference: they are plain
 * data and the store never mutates them in place.
 */
export function captureStorageState(
  state: AppState,
  mirrors: StorageMirrors,
  path: string,
): StorageState {
  return {
    path,
    tree: state.tree,
    note: state.note,
    // The parts of the state are taken by reference: the store never changes
    // them in place, it builds new ones. The registry and the store therefore
    // see the same tree, and the copy of the state stays cheap.
    expanded: state.ui.expanded,
    openPaths: state.ui.openPaths,
    recentPaths: state.ui.recentPaths,
    mirrors: { ...mirrors },
  };
}

/**
 * Puts the state of a storage back into the state of the store.
 *
 * The parts of the state that do not belong to a storage (the theme, the
 * connection, the dialogs) stay as they are: they belong to the application
 * and not to a folder of notes.
 */
export function applyStorageState(state: AppState, storage: StorageState): AppState {
  return {
    ...state,
    tree: storage.tree,
    note: storage.note,
    ui: {
      ...state.ui,
      expanded: new Set(storage.expanded),
      openPaths: [...storage.openPaths],
      recentPaths: [...storage.recentPaths],
    },
  };
}
