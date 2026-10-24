// Local draft persistence in IndexedDB (never lose edits on network errors).
import type { IDBPDatabase } from 'idb';

export interface Draft {
  path: string;
  content: string;
  revision: number;
  updatedAt: number;
}

const DB_NAME = 'noto';
const DB_VERSION = 1;
const STORE = 'drafts';
const SEALED_STORE = 'sealed-drafts';

let dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * Opens the draft database on first use.
 *
 * `idb` is imported dynamically so that the IndexedDB helper stays out of the
 * start-up bundle; it is only needed once drafts are actually read or written.
 */
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = import('idb')
      .then(({ openDB }) =>
        openDB(DB_NAME, DB_VERSION, {
          upgrade(database) {
            if (!database.objectStoreNames.contains(STORE)) {
              database.createObjectStore(STORE, { keyPath: 'path' });
            }
            if (!database.objectStoreNames.contains(SEALED_STORE)) {
              database.createObjectStore(SEALED_STORE);
            }
          },
        }),
      )
      .catch((error: unknown) => {
        // Allow a later call to retry opening the database.
        dbPromise = null;
        throw error;
      });
  }
  return dbPromise;
}

export async function putDraft(draft: Draft): Promise<void> {
  const database = await db();
  await database.put(STORE, draft);
}

export async function getDraft(path: string): Promise<Draft | undefined> {
  const database = await db();
  return database.get(STORE, path);
}

export async function deleteDraft(path: string): Promise<void> {
  const database = await db();
  await database.delete(STORE, path);
}

export async function listDrafts(): Promise<Draft[]> {
  const database = await db();
  return database.getAll(STORE);
}

/* ------------------------------------------------------- encrypted drafts */

/**
 * The raw storage of the encrypted drafts.
 *
 * The encrypted storage keeps its unsaved work in the same database, but the
 * payload is ciphertext: the database of a sealed storage must never contain
 * a readable note. This module only moves bytes; the encryption happens in
 * the core (`src/core/vault/sealedDrafts.ts`), which owns the key.
 */
export async function putSealedDraft(id: string, payload: Uint8Array): Promise<void> {
  const database = await db();
  await database.put(SEALED_STORE, payload, id);
}

export async function getSealedDraft(id: string): Promise<Uint8Array | undefined> {
  const database = await db();
  const value = await database.get(SEALED_STORE, id);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  // Some environments return the view of the buffer instead of the view
  // itself; the bytes are the same.
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
}

export async function deleteSealedDraft(id: string): Promise<void> {
  const database = await db();
  await database.delete(SEALED_STORE, id);
}

/** Removes every encrypted draft; called when the storage is locked. */
export async function clearSealedDrafts(): Promise<void> {
  const database = await db();
  await database.clear(SEALED_STORE);
}

/**
 * True when the local draft is newer than the server copy and therefore
 * holds unsaved work worth offering for recovery.
 */
export function isDraftNewer(draft: Draft, serverUpdatedAt: string, serverContent: string): boolean {
  if (draft.content === serverContent) return false;
  const serverTime = Date.parse(serverUpdatedAt);
  if (Number.isNaN(serverTime)) return true;
  return draft.updatedAt > serverTime;
}
