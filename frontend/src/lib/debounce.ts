// Debouncing helper.

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
