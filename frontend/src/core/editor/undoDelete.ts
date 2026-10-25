// The undo of a deletion.
//
// A deleted note can be restored from the trash, but the user must not have
// to walk there for a slip of the finger. For five seconds after the
// deletion the application offers to undo it.
//
// The controller owns the timer and the offer; it knows nothing about the
// store and nothing about the interface, so it can be tested with fake
// timers.

/** The time the offer of the undo stays on the screen, in milliseconds. */
export const UNDO_DELETE_TIMEOUT_MS = 5000;

/** The note that can be restored. */
export interface UndoDeleteOffer {
  /** The path of the deleted note. */
  path: string;
  /** The name of the deleted note, shown in the toast. */
  name: string;
}

/** The controller of the offer of the undo. */
export interface UndoDeleteController {
  /**
   * Offers the undo of a deletion.
   *
   * A second deletion replaces the first offer: only the last one can be
   * undone.
   */
  offer(offer: UndoDeleteOffer): void;
  /**
   * Takes the offer back, so the user can restore the note.
   *
   * @returns the offer that was taken back, or `null` when there was none.
   */
  undo(): UndoDeleteOffer | null;
  /** Throws the offer away, without restoring the note. */
  dismiss(): void;
  /** The offer that is on the screen, if there is one. */
  current(): UndoDeleteOffer | null;
  /** Subscribes to the changes of the offer; returns the unsubscribe. */
  subscribe(cb: (offer: UndoDeleteOffer | null) => void): () => void;
  /** Stops the timer and drops the subscribers. */
  dispose(): void;
}

/**
 * Creates the controller of the offer of the undo.
 *
 * @param options.timeoutMs The time the offer stays, in milliseconds.
 * @param options.onExpire Called when the offer disappears on its own.
 */
export function createUndoDeleteController(options?: {
  timeoutMs?: number;
  onExpire?(offer: UndoDeleteOffer): void;
}): UndoDeleteController {
  const timeoutMs = options?.timeoutMs ?? UNDO_DELETE_TIMEOUT_MS;
  const subscribers = new Set<(offer: UndoDeleteOffer | null) => void>();
  let offer: UndoDeleteOffer | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const notify = (): void => {
    for (const cb of [...subscribers]) {
      try {
        cb(offer);
      } catch {
        /* a broken subscriber must not break the deletion */
      }
    }
  };

  const expire = (): void => {
    const expired = offer;
    timer = null;
    offer = null;
    notify();
    if (expired) options?.onExpire?.(expired);
  };

  return {
    offer(next: UndoDeleteOffer): void {
      clear();
      offer = next;
      timer = setTimeout(expire, timeoutMs);
      notify();
    },
    undo(): UndoDeleteOffer | null {
      const current = offer;
      clear();
      offer = null;
      notify();
      return current;
    },
    dismiss(): void {
      clear();
      offer = null;
      notify();
    },
    current(): UndoDeleteOffer | null {
      return offer;
    },
    subscribe(cb: (offer: UndoDeleteOffer | null) => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    dispose(): void {
      clear();
      offer = null;
      subscribers.clear();
    },
  };
}
