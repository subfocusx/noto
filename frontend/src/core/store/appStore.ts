// The public facade of the application store.
//
// The state used to live inside `App.tsx` as a dozen `useState` calls; it now
// lives in this module level singleton. `App.tsx` is a thin composer that
// reads the state and calls the actions, and a plugin host can get hold of
// the very same store (`appStore`) instead of poking at component internals.
//
// Subscription model:
//   subscribe(listener) -> unsubscribe   — the listener is called after every
//                                         state change; `useSyncExternalStore`
//                                         (see `./hooks.ts`) turns that into a
//                                         re-render of the Preact tree.
import {
  actions,
  applyTheme,
  refreshTree,
  resetAutosave,
  setOnline,
  type AppActions,
} from './actions';
import { getSnapshot, notify, resetState, subscribe } from './state';

/* -------------------------------------------------------------- lifecycle */

let started = false;
let cleanupEnvironment: (() => void) | null = null;

/** Wires the browser environment and loads the tree for the first time. */
export function start(): void {
  if (started) return;
  started = true;
  applyTheme(getSnapshot().env.theme);

  const goOnline = () => setOnline(true);
  const goOffline = () => setOnline(false);
  window.addEventListener('online', goOnline);
  window.addEventListener('offline', goOffline);

  // Keep the layout height in sync with the mobile keyboard viewport.
  const viewport = typeof window !== 'undefined' ? window.visualViewport : undefined;
  let removeViewport: (() => void) | null = null;
  if (viewport) {
    const updateHeight = () => {
      document.documentElement.style.setProperty('--app-height', `${viewport.height}px`);
    };
    updateHeight();
    viewport.addEventListener('resize', updateHeight);
    viewport.addEventListener('scroll', updateHeight);
    removeViewport = () => {
      viewport.removeEventListener('resize', updateHeight);
      viewport.removeEventListener('scroll', updateHeight);
    };
  }

  cleanupEnvironment = () => {
    window.removeEventListener('online', goOnline);
    window.removeEventListener('offline', goOffline);
    removeViewport?.();
  };

  void refreshTree();
}

/** Removes the browser listeners and resets the state. */
export function stop(): void {
  if (!started) return;
  started = false;
  cleanupEnvironment?.();
  cleanupEnvironment = null;
  // The subscribers are not notified: the app is being torn down.
  resetState();
  resetAutosave();
}

/** Resets the store and notifies the subscribers. */
export function reset(): void {
  resetState();
  resetAutosave();
  notify();
}

/** The application store: state, subscription and actions. */
export const appStore = {
  subscribe,
  getSnapshot,
  actions,
  start,
  stop,
  reset,
};

export type { AppActions };
export type { AppState, DialogState, ViewMode } from './types';
