// The debounce of the "Backlinks" plugin.
//
// The plugin must not import the shared helpers of the application
// (`src/lib/utils.ts` is outside of the plugin boundary, rule R3), so the
// debounce lives inside the package of the plugin.
//
// Semantics:
//
//   * `schedule()` postpones the call; the delay restarts on every call, so a
//     burst of changes results in exactly ONE call;
//   * `flush()` runs the call immediately (the scheduled call is dropped);
//   * `cancel()` drops the scheduled call without running it.
//
// The timer is a plain `setTimeout`, so the tests can drive it with the fake
// timers of vitest.

/** A debounced function. */
export interface Debouncer {
  /** Schedules the call; a pending call is postponed. */
  schedule(): void;
  /** Runs the call right now (a pending call is dropped). */
  flush(): void;
  /** Drops the pending call without running it. */
  cancel(): void;
  /** True while a call is scheduled. */
  readonly pending: boolean;
}

/**
 * Creates a debounced wrapper around `fn`.
 *
 * @param fn The function to debounce.
 * @param delayMs The delay of the call, in milliseconds.
 */
export function createDebouncer(fn: () => void, delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    get pending(): boolean {
      return timer !== null;
    },
    schedule(): void {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    flush(): void {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      fn();
    },
    cancel(): void {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}
