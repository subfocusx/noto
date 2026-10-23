// Small helpers shared by the app.

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
  flush(): void;
  pending(): boolean;
}

/** Creates a debounced function; call `cancel` to drop pending calls. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const wrapper = ((...args: A) => {
    lastArgs = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const args2 = lastArgs;
      lastArgs = null;
      if (args2) fn(...args2);
    }, delay);
  }) as Debounced<A>;

  wrapper.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  wrapper.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      const args2 = lastArgs;
      lastArgs = null;
      if (args2) fn(...args2);
    }
  };
  wrapper.pending = () => timer !== null;
  return wrapper;
}

/** Human readable byte size. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Deterministic string comparison by code unit.
 * `localeCompare` depends on the locale of the runtime and would make the
 * order of the tree and of wiki links differ between environments.
 */
export function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
