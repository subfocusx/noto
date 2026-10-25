// The tooltip of the truncated names.
//
// A long name in the tree is cut off with an ellipsis. The full name has to
// stay reachable, but a permanent `title` on every row is noisy: the browser
// shows it even for the short names that fit.
//
// The idea is taken from the `useOverflowTitle` hook of Memos (MIT): the
// attribute is set only when the text is really clipped, and it is updated
// when the column is resized.
import { useEffect, useRef, useState } from 'preact/hooks';

export interface OverflowTitle {
  /** The reference of the element that carries the text. */
  ref: (element: HTMLElement | null) => void;
  /** The value of the `title` attribute, or `undefined` when it fits. */
  title: string | undefined;
}

/**
 * Watches the element and reports whether its text is cut off.
 *
 * @param text the full text of the element
 */
export function useOverflowTitle(text: string): OverflowTitle {
  const elementRef = useRef<HTMLElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const check = () => {
      setOverflowing(element.scrollWidth > element.clientWidth + 1);
    };

    check();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', check);
      return () => window.removeEventListener('resize', check);
    }

    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return {
    ref: (element: HTMLElement | null) => {
      elementRef.current = element;
    },
    title: overflowing ? text : undefined,
  };
}
