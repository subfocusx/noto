// The registry of the open storages of the notes.
//
// The registry is the map of the states of the storages: one state per path.
// The state of the storage that is active is also published to the store (the
// store holds it, the registry keeps a copy of it).
//
// The registry knows nothing about the server: it only remembers what the
// interface showed for every storage. The switch of the storage on the disk is
// the business of the actions of the store (`../store/actions.ts`).
import { captureStorageState, storageKey, type StorageMirrors, type StorageState } from './storageState';
import type { AppState } from '../store/types';

/** The registry of the open storages. */
export class StorageRegistry {
  private readonly states = new Map<string, StorageState>();

  /** The state of a storage, or undefined when it was never opened. */
  get(path: string): StorageState | undefined {
    return this.states.get(storageKey(path));
  }

  /** True when the storage keeps a state in the registry. */
  has(path: string): boolean {
    return this.states.has(storageKey(path));
  }

  /**
   * Remembers the state of a storage.
   *
   * A storage becomes open when the server accepted it: the registry never
   * creates one by itself.
   */
  set(path: string, storage: StorageState): void {
    this.states.set(storageKey(path), storage);
  }

  /**
   * Keeps the copy of the active storage up to date.
   *
   * The store publishes the state of the active storage; the registry keeps a
   * copy of it, so the switch back to the storage finds the tree and the note
   * it left there. A storage that is not open is not created here: only the
   * switch opens a storage.
   */
  sync(path: string, state: AppState, mirrors: StorageMirrors): void {
    const key = storageKey(path);
    const current = this.states.get(key);
    if (!current) return;
    if (
      current.tree === state.tree &&
      current.note === state.note &&
      current.expanded === state.ui.expanded &&
      current.openPaths === state.ui.openPaths &&
      current.recentPaths === state.ui.recentPaths
    ) {
      // Only the mirrors changed: the text of the note is written there.
      current.mirrors = { ...mirrors };
      return;
    }
    this.set(path, captureStorageState(state, mirrors, path));
  }

  /**
   * Forgets a storage.
   *
   * A closed storage loses its state: the tree, the note and the folders of
   * the storage are gone, and opening the storage again starts from nothing.
   */
  close(path: string): boolean {
    return this.states.delete(storageKey(path));
  }

  /** The paths of the open storages, in the order they were opened. */
  paths(): string[] {
    return [...this.states.values()].map((storage) => storage.path);
  }

  /** Forgets every storage. */
  clear(): void {
    this.states.clear();
  }
}

/** The registry of the application. */
export const storageRegistry = new StorageRegistry();
