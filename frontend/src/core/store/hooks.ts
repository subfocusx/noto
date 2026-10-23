// Preact bindings for the application store.
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

/** The actions of the application store (stable reference). */
export function useAppActions(): AppActions {
  return appStore.actions;
}
