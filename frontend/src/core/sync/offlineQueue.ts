// The queue of the writes that wait for the connection.
//
// When the backend cannot be reached, a write must not be lost: it goes into
// this queue with its kind, its payload, the path of the note and the moment
// of the write. The queue lives in the browser (IndexedDB), so it survives a
// reload of the page.
//
// The queue is replayed when the connection comes back (see
// `./offlineReplay.ts`): the writes go out one by one, in the order they were
// made. A write that fails again stays in the queue and the next one is not
// sent: the order of the writes of a user is a part of their meaning.
//
// The queue knows nothing about the notes themselves: the payload is an opaque
// string, and the codec that wrote it says how it must be read back.
import {
  deleteOutboxEntry,
  listOutboxEntries,
  putOutboxEntry,
  type OutboxEntry,
} from '../../lib/sync/outbox';

/** The kinds of the writes that can wait for the connection. */
export type OfflineWriteKind =
  | 'saveNote'
  | 'createFile'
  | 'createFolder'
  | 'renameNote'
  | 'moveNote'
  | 'deleteNote'
  | 'duplicateNote'
  | 'restoreNote';

/**
 * The name of the codec of a payload.
 *
 * `json` is the payload of an open storage; `sealed` is the payload of an
 * encrypted storage, written with the key of the vault.
 */
export type OfflineCodecName = 'json' | 'sealed';

/** One write that waits for the connection. */
export interface OfflineWrite {
  /** The identifier of the write. */
  id: string;
  /** The kind of the write. */
  kind: OfflineWriteKind;
  /** The path of the note the write is about. */
  path: string;
  /** The encoded payload of the write. */
  payload: string;
  /** The name of the codec the payload was written with. */
  codec: OfflineCodecName;
  /** The moment of the write, in milliseconds since the epoch. */
  createdAt: number;
  /** The order of the write. */
  seq: number;
}

/** What a caller gives to the queue. */
export interface OfflineWriteInput {
  /** The kind of the write. */
  kind: OfflineWriteKind;
  /** The path of the note the write is about. */
  path: string;
  /** The encoded payload of the write. */
  payload: string;
  /** The name of the codec the payload was written with. */
  codec: OfflineCodecName;
}

/** The storage the queue writes into; the tests use another one. */
export interface OutboxStorage {
  put(entry: OutboxEntry): Promise<void>;
  list(): Promise<OutboxEntry[]>;
  remove(id: string): Promise<void>;
}

/** Sends one write to the server. */
export type OfflineSender = (write: OfflineWrite) => Promise<void>;

/** What a replay of the queue did. */
export interface FlushResult {
  /** The number of the writes that left the queue. */
  sent: number;
  /** The write that failed, if any; it is still in the queue. */
  failed: OfflineWrite | null;
  /** The number of the writes that wait after the replay. */
  remaining: number;
}

/** The storage of the browser the queue uses by default. */
export const idbOutboxStorage: OutboxStorage = {
  put: (entry) => putOutboxEntry(entry),
  list: () => listOutboxEntries(),
  remove: (id) => deleteOutboxEntry(id),
};

/** The publisher of the number of the writes that wait. */
export type PendingSyncPublisher = (pending: number) => void;

let publisher: PendingSyncPublisher | null = null;
let pending = 0;

/**
 * Installs the publisher of the number of the writes that wait.
 *
 * The store installs it (see `../store/offlineQueue.ts`): the queue lives in
 * the core and it does not know the store.
 */
export function setPendingSyncPublisher(next: PendingSyncPublisher | null): void {
  publisher = next;
  if (next) next(pending);
}

/** Publishes the number of the writes that wait. */
export function publishPendingSync(count: number): void {
  pending = count;
  publisher?.(count);
}

/** The number of the writes that wait, as it was published. */
export function pendingSyncCount(): number {
  return pending;
}

/* ------------------------------------------------------------- the replay */

let replaying = false;

/**
 * True while the queue is replaying its writes.
 *
 * A write that fails during a replay must not be queued a second time: it is
 * already in the queue, and it stays there until it succeeds.
 */
export function isReplaying(): boolean {
  return replaying;
}

/** Runs a function while the queue replays its writes. */
export async function withReplay<T>(run: () => Promise<T>): Promise<T> {
  replaying = true;
  try {
    return await run();
  } finally {
    replaying = false;
  }
}

/* ------------------------------------------------------------- the queue */

export interface OfflineQueueOptions {
  /** The clock of the queue; the tests may freeze it. */
  now?: () => number;
  /** The factory of the identifiers of the writes. */
  newId?: () => string;
}

let idCounter = 0;

/**
 * The queue of the writes that wait for the connection.
 *
 * The queue is serial: an `enqueue` and a `flush` never run at the same time,
 * so the order of the writes is the order the user made them.
 */
export class OfflineQueue {
  private readonly storage: OutboxStorage;
  private readonly now: () => number;
  private readonly newId: () => string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(storage: OutboxStorage = idbOutboxStorage, options: OfflineQueueOptions = {}) {
    this.storage = storage;
    this.now = options.now ?? (() => Date.now());
    this.newId =
      options.newId ??
      (() => {
        idCounter += 1;
        return `w${this.now().toString(36)}-${idCounter.toString(36)}`;
      });
  }

  /** Puts a write into the queue. */
  enqueue(input: OfflineWriteInput): Promise<OfflineWrite> {
    return this.run(async () => {
      const entries = await this.storage.list();
      const seq = entries.reduce((max, entry) => Math.max(max, entry.seq), 0) + 1;
      const write: OfflineWrite = {
        id: this.newId(),
        kind: input.kind,
        path: input.path,
        payload: input.payload,
        codec: input.codec,
        createdAt: this.now(),
        seq,
      };
      await this.storage.put({ ...write });
      await this.publishCount();
      return write;
    });
  }

  /** The writes that wait, the oldest first. */
  async list(): Promise<OfflineWrite[]> {
    const entries = await this.storage.list();
    return entries
      .slice()
      .sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt)
      .map((entry) => ({
        ...entry,
        kind: entry.kind as OfflineWriteKind,
        codec: entry.codec as OfflineCodecName,
      }));
  }

  /** The number of the writes that wait. */
  async count(): Promise<number> {
    const entries = await this.storage.list();
    return entries.length;
  }

  /**
   * Sends the writes to the server, one by one, in the order they were made.
   *
   * A write that fails stops the replay: it stays in the queue and the writes
   * that come after it are not sent, because they may depend on it.
   */
  flush(sender: OfflineSender): Promise<FlushResult> {
    return this.run(async () => {
      const writes = await this.list();
      let sent = 0;
      let failed: OfflineWrite | null = null;
      for (const write of writes) {
        try {
          await sender(write);
        } catch {
          failed = write;
          break;
        }
        await this.storage.remove(write.id);
        sent += 1;
      }
      await this.publishCount();
      return { sent, failed, remaining: await this.count() };
    });
  }

  /** Removes every write from the queue. */
  clear(): Promise<void> {
    return this.run(async () => {
      const writes = await this.list();
      for (const write of writes) await this.storage.remove(write.id);
      await this.publishCount();
    });
  }

  /** Publishes the number of the writes that wait. */
  private async publishCount(): Promise<void> {
    publishPendingSync(await this.count());
  }

  /** Runs a task after the previous one; the queue is serial. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

/** The queue of the application. */
export const offlineQueue = new OfflineQueue();

/** Puts a write into the queue of the application. */
export async function enqueueOfflineWrite(input: OfflineWriteInput): Promise<void> {
  await offlineQueue.enqueue(input);
}
