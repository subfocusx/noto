// A tiny synchronous typed event bus.
//
// Rules:
//   * delivery is synchronous and in registration order;
//   * every subscriber runs inside its own try/catch, so a broken
//     subscriber cannot stop the others;
//   * re-entrant emission of the *same* event is ignored (no recursion);
//   * `on()` returns an idempotent unsubscribe function.
//
// The bus is deliberately untyped by default (`Record<string, unknown>`) so
// that it stays usable outside of the plugin layer; consumers that own a
// typed event map instantiate it as `new EventBus<MyEventMap>()`.

export type EventListener<TPayload> = (payload: TPayload) => void;

/** Default event map: any event name with an `unknown` payload. */
export type DefaultEventMap = Record<string, unknown>;

export class EventBus<TMap extends object = DefaultEventMap> {
  private readonly listeners = new Map<string, Set<EventListener<never>>>();
  /** Events currently being delivered — used to break recursion. */
  private readonly delivering = new Set<string>();

  /**
   * Subscribes to an event.
   *
   * @returns an idempotent unsubscribe function.
   */
  on<K extends Extract<keyof TMap, string>>(
    event: K,
    cb: EventListener<TMap[K]>,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const listener = cb as EventListener<never>;
    set.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.off(event, cb);
    };
  }

  /** Removes a subscriber. Unknown subscribers are ignored. */
  off<K extends Extract<keyof TMap, string>>(event: K, cb: EventListener<TMap[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(cb as EventListener<never>);
    if (set.size === 0) this.listeners.delete(event);
  }

  /**
   * Delivers a payload to all subscribers, synchronously.
   *
   * A subscriber that throws is logged and skipped; the remaining
   * subscribers still receive the event.
   */
  emit<K extends Extract<keyof TMap, string>>(event: K, payload: TMap[K]): void {
    // Recursion guard: the same event is not re-entered while it is being
    // delivered. This keeps a self-triggering plugin from looping forever.
    if (this.delivering.has(event)) return;

    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;

    // Copy the set: a subscriber may unsubscribe itself during delivery.
    const snapshot = Array.from(set);
    this.delivering.add(event);
    try {
      for (const listener of snapshot) {
        try {
          (listener as EventListener<TMap[K]>)(payload);
        } catch (err) {
          console.warn('[noto:events] subscriber failed', event, err);
        }
      }
    } finally {
      this.delivering.delete(event);
    }
  }

  /** Number of subscribers registered for an event. */
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Removes every subscriber. */
  clear(): void {
    this.listeners.clear();
    this.delivering.clear();
  }
}
