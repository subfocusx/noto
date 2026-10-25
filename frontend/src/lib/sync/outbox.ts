// The outbox of the browser: the writes that could not reach the server.
//
// A write that fails because the backend is unreachable must not be lost: it
// waits in this database until the connection comes back. The outbox is a
// database of its own (`noto-outbox`), so it never fights with the drafts
// (`noto`) over the version of the schema.
//
// The module only moves entries: it knows nothing about the notes and nothing
// about the encryption. The payload is an opaque string; the layer that
// writes it (the vault service) decides how it is encoded.
import type { IDBPDatabase } from 'idb';

/** One write that waits for the connection. */
export interface OutboxEntry {
  /** The identifier of the entry; it never changes. */
  id: string;
  /** The kind of the write (`saveNote`, `createFile`, ...). */
  kind: string;
  /** The path of the note the write is about. */
  path: string;
  /** The encoded payload of the write. */
  payload: string;
  /** The name of the codec the payload was written with. */
  codec: string;
  /** The moment of the write, in milliseconds since the epoch. */
  createdAt: number;
  /** The order of the write; the queue replays the writes in this order. */
  seq: number;
}

const DB_NAME = 'noto-outbox';
const DB_VERSION = 1;
const STORE = 'outbox';

let dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * Opens the outbox on first use.
 *
 * `idb` is imported dynamically, like in `./drafts`: the helper stays out of
 * the start-up bundle and it is only needed once a write really waits.
 */
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = import('idb')
      .then(({ openDB }) =>
        openDB(DB_NAME, DB_VERSION, {
          upgrade(database) {
            if (!database.objectStoreNames.contains(STORE)) {
              database.createObjectStore(STORE, { keyPath: 'id' });
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

/** Writes an entry into the outbox. */
export async function putOutboxEntry(entry: OutboxEntry): Promise<void> {
  const database = await db();
  await database.put(STORE, entry);
}

/**
 * Reads every entry of the outbox, the oldest write first.
 *
 * The order is the order of the writes: the queue replays them one by one and
 * a write that fails must block the ones that come after it.
 */
export async function listOutboxEntries(): Promise<OutboxEntry[]> {
  const database = await db();
  const entries = (await database.getAll(STORE)) as OutboxEntry[];
  return entries.sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt);
}

/** Removes one entry from the outbox. */
export async function deleteOutboxEntry(id: string): Promise<void> {
  const database = await db();
  await database.delete(STORE, id);
}

/** The number of the writes that wait. */
export async function countOutboxEntries(): Promise<number> {
  const database = await db();
  return database.count(STORE);
}

/** Removes every entry from the outbox. */
export async function clearOutbox(): Promise<void> {
  const database = await db();
  await database.clear(STORE);
}
