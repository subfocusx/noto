// Autosave controller: debounced saving with status tracking and a
// path/revision guard so a response of a previous note is never applied to the
// note that is currently open.
//
// The controller serialises the saves **per note**: only one request per note
// is in flight at a time. Without it, a second save of the same note would
// leave with the revision of the first one and the server would answer with a
// conflict — a conflict the user never caused.
//
// The pending edit of every note is kept separately, so an edit of one note is
// never lost because another note was edited in the meantime.
import { debounce, type Debounced } from './debounce';
import { errorMessage } from './errors';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveOptions {
  /** Debounce delay in milliseconds. */
  delay?: number;
  /**
   * Performs the actual save; may reject to signal a failure.
   * May return the new server revision, which is then used for the next save.
   */
  save(path: string, content: string, revision: number): Promise<void | number>;
  /** Called whenever the status changes. */
  onStatus?(status: AutosaveStatus, error?: string): void;
}

export interface AutosaveController {
  /** Marks the note as dirty and schedules a save. */
  markDirty(path: string, content: string, revision: number): void;
  /** Cancels a pending save and saves right away. */
  flush(): Promise<void>;
  /** Cancels a pending save without saving. */
  cancel(): void;
  /** Sets the note that is currently open; responses of other notes are ignored. */
  setActivePath(path: string | null): void;
  /** Marks the note as clean (e.g. after a successful save). */
  markClean(): void;
  status(): AutosaveStatus;
  dirty(): boolean;
  pending(): boolean;
}

interface Pending {
  path: string;
  content: string;
  revision: number;
}

export function createAutosave(options: AutosaveOptions): AutosaveController {
  const delay = options.delay ?? 800;
  let status: AutosaveStatus = 'idle';
  let dirty = false;
  let activePath: string | null = null;
  /** Sequence number of the newest edit; used to detect superseded responses. */
  let seq = 0;
  /** The pending edit of every note. */
  const pendingByPath = new Map<string, Pending>();
  /** The newest server revision known for a note. */
  const revisions = new Map<string, number>();
  /** The content that the server accepted last; it is never sent twice. */
  const saved = new Map<string, string>();
  /** The chain of the saves of every note: one request per note at a time. */
  const chains = new Map<string, Promise<void>>();
  /** The request that is in flight for a note. */
  const inflight = new Map<string, Promise<void>>();

  const setStatus = (next: AutosaveStatus, error?: string) => {
    status = next;
    options.onStatus?.(next, error);
  };

  const startSave = (target: Pending, mySeq: number): Promise<void> => {
    const isCurrent = () => mySeq === seq && activePath === target.path;
    const promise = (async () => {
      if (isCurrent()) setStatus('saving');
      try {
        const newRevision = await options.save(target.path, target.content, target.revision);
        // The server accepted the write, so the revision is known even when the
        // response is superseded by a newer edit.
        if (typeof newRevision === 'number') {
          revisions.set(target.path, newRevision);
          const pending = pendingByPath.get(target.path);
          if (pending) pending.revision = newRevision;
        }
        saved.set(target.path, target.content);
        if (!isCurrent()) return;
        // The note may have been edited again while the save was in flight.
        const pending = pendingByPath.get(target.path);
        if (pending && pending.content === target.content) {
          pendingByPath.delete(target.path);
          dirty = pendingByPath.size > 0;
          setStatus('saved');
        } else {
          dirty = true;
          setStatus('idle');
        }
      } catch (err) {
        if (!isCurrent()) return;
        dirty = true;
        setStatus('error', errorMessage(err));
      }
    })();
    inflight.set(target.path, promise);
    void promise.then(() => {
      if (inflight.get(target.path) === promise) inflight.delete(target.path);
    });
    return promise;
  };

  /**
   * Puts a save of the note into the chain of that note.
   *
   * The chain is what makes the saves serial: the second save of a note waits
   * for the first one, takes the revision it returned and sends the newest
   * content. Two requests of the same note never travel at the same time, so
   * the server never sees a stale revision.
   */
  const enqueue = (path: string): Promise<void> => {
    const previous = chains.get(path) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const current = pendingByPath.get(path);
        if (!current) return;
        if (saved.get(path) === current.content) {
          // The content is already on the server: nothing to send.
          pendingByPath.delete(path);
          dirty = pendingByPath.size > 0;
          return;
        }
        const known = revisions.get(path);
        const revision = known === undefined ? current.revision : Math.max(known, current.revision);
        seq += 1;
        await startSave({ path, content: current.content, revision }, seq);
      });
    chains.set(path, next);
    void next.finally(() => {
      if (chains.get(path) === next) chains.delete(path);
    });
    return next;
  };

  /**
   * The debounce of every note.
   *
   * The debounce is per note: the edit of one note must not cancel the timer
   * of another one.
   */
  const debouncers = new Map<string, Debounced<[Pending]>>();
  const debounceFor = (path: string): Debounced<[Pending]> => {
    let timer = debouncers.get(path);
    if (!timer) {
      timer = debounce((target: Pending) => {
        void enqueue(target.path);
      }, delay);
      debouncers.set(path, timer);
    }
    return timer;
  };

  /** Cancels the timers of every note. */
  const cancelAll = (): void => {
    for (const timer of debouncers.values()) timer.cancel();
  };

  return {
    markDirty(path: string, content: string, revision: number) {
      dirty = true;
      // The revision of the server only grows, so the newest known one wins.
      const known = revisions.get(path);
      const rev = known === undefined ? revision : Math.max(known, revision);
      revisions.set(path, rev);
      pendingByPath.set(path, { path, content, revision: rev });
      seq += 1;
      // While a save is running the status stays "saving" until it settles.
      if (inflight.size === 0) setStatus('idle');
      debounceFor(path)(pendingByPath.get(path)!);
    },
    async flush() {
      const target = activePath ? pendingByPath.get(activePath) : undefined;
      const snapshot = target ?? [...pendingByPath.values()][0];
      // Nothing was edited: never send a request (it would overwrite the note).
      if (!snapshot) return;
      cancelAll();
      await enqueue(snapshot.path);
    },
    cancel() {
      cancelAll();
    },
    setActivePath(path: string | null) {
      activePath = path;
    },
    markClean() {
      dirty = false;
      pendingByPath.clear();
      seq += 1;
      cancelAll();
      setStatus('idle');
    },
    status: () => status,
    dirty: () => dirty,
    pending: () => [...debouncers.values()].some((timer) => timer.pending()),
  };
}
