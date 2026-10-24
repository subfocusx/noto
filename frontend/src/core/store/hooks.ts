// Preact bindings for the application store.
import { useCallback, useRef } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import { appStore, type AppActions } from './appStore';
import type { AppState } from './types';

/**
 * Subscribes the calling component to the application state.
 * The component re-renders whenever the state changes; the subscription is
 * removed when the component is unmounted.
 */
export function useAppState(): AppState {
  return useSyncExternalStore(appStore.subscribe, appStore.getSnapshot);
}

/**
 * Subscribes the calling component to a part of the application state.
 *
 * The component re-renders only when the value of the selector changes. It
 * keeps a list of many rows from being redrawn on every keystroke of the
 * editor: a row of the tree that shows whether a note is a favorite must not
 * be redrawn because the text of the note has changed.
 *
 * The selector must answer a primitive (a boolean, a number, a string): the
 * snapshot of the subscription is compared by value.
 */
export function useAppSelector<T>(selector: (state: AppState) => T): T {
  // The selector is read through a reference, so the caller may write it
  // inline without rebuilding the subscription on every render.
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const getSnapshot = useCallback(() => selectorRef.current(appStore.getSnapshot()), []);
  return useSyncExternalStore(appStore.subscribe, getSnapshot);
}

/** The actions of the application store (stable reference). */
export function useAppActions(): AppActions {
  return appStore.actions;
}
