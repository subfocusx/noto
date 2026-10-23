// Autosave controller: debounced saving with status tracking and a
// path/revision guard so a response of a previous note is never applied to
// the note that is currently open.
import { debounce, errorMessage } from './utils';

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
  /** The latest unsaved snapshot (the note that owns it may differ from activePath). */
  let pending: Pending | null = null;
  /** The newest server revision known for a note. */
  const revisions = new Map<string, number>();
  let inflight: { target: Pending; promise: Promise<void> } | null = null;

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
          if (pending?.path === target.path) pending.revision = newRevision;
        }
        if (!isCurrent()) return;
        // The note may have been edited again while the save was in flight.
        if (pending && pending.path === target.path && pending.content === target.content) {
          pending = null;
          dirty = false;
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
    inflight = { target, promise };
    void promise.then(() => {
      if (inflight?.promise === promise) {
        inflight = null;
        // A superseded save leaves the newer edit unsaved: show it as pending.
        if (pending && status === 'saving') setStatus('idle');
      }
    });
    return promise;
  };

  const debounced = debounce((target: Pending, mySeq: number) => {
    void startSave(target, mySeq);
  }, delay);

  return {
    markDirty(path: string, content: string, revision: number) {
      dirty = true;
      // The revision of the server only grows, so the newest known one wins.
      const known = revisions.get(path);
      const rev = known === undefined ? revision : Math.max(known, revision);
      revisions.set(path, rev);
      pending = { path, content, revision: rev };
      seq += 1;
      // While a save is running the status stays "saving" until it settles.
      if (!inflight) setStatus('idle');
      debounced(pending, seq);
    },
    async flush() {
      const target = pending;
      // Nothing was edited: never send a request (it would overwrite the note).
      if (!target) return;
      debounced.cancel();
      // A save of the same note is still running: wait for it, otherwise the
      // second request would use a stale revision and conflict with the first.
      if (inflight && inflight.target.path === target.path) {
        await inflight.promise;
        const current = pending;
        if (!current || current.content === inflight.target.content) return;
        seq += 1;
        await startSave(current, seq);
        return;
      }
      seq += 1;
      await startSave(target, seq);
    },
    cancel() {
      debounced.cancel();
    },
    setActivePath(path: string | null) {
      activePath = path;
    },
    markClean() {
      dirty = false;
      pending = null;
      seq += 1;
      debounced.cancel();
      setStatus('idle');
    },
    status: () => status,
    dirty: () => dirty,
    pending: () => debounced.pending(),
  };
}
