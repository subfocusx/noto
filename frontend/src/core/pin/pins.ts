// The pins: the notes the user keeps at the top of the tree.
//
// The pins are stored in the local storage of the browser, under their own
// key — the same mechanism as the favorites and the saved views. The order of
// the pins is the order of the list: the first pin is the first note of the
// pinned group, and it stays there until the user moves it.
import { useSyncExternalStore } from 'preact/compat';
import type { Node } from '../../types';

/** The key of the pins in the local storage. */
export const PINS_KEY = 'noto.pins.v1';

/** The greatest number of the pins the user may keep. */
export const PINS_LIMIT = 200;

/** The pins of the user, in the order they were pinned. */
export type Pins = readonly string[];

/** The listeners that wait for a change of the pins. */
const listeners = new Set<() => void>();

/**
 * The pins of the current session; they are the truth until the storage is read.
 *
 * The array is frozen and is never replaced by a copy: the interface compares
 * it by identity, so the reference must change only when the pins change.
 */
let current: readonly string[] = Object.freeze([]);

/** The storage of the browser, when there is one (the tests have it too). */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The pins that are read from the storage.
 *
 * The entries that are not the path of a note are dropped: a pin of a note
 * that does not exist any more would be a ghost in the tree.
 */
export function parsePins(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const pins: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const path = item.trim();
      if (!path || pins.includes(path)) continue;
      pins.push(path);
      if (pins.length >= PINS_LIMIT) break;
    }
    return pins;
  } catch {
    return [];
  }
}

/** The pins of the user, as they are stored. */
export function loadPins(): readonly string[] {
  const pins = parsePins(storage()?.getItem(PINS_KEY) ?? null);
  current = Object.freeze(pins);
  return current;
}

/** The pins of the user, as they are right now. */
export function getPins(): readonly string[] {
  return current;
}

/** Writes the pins and tells the interface that they have changed. */
export function setPins(pins: readonly string[]): readonly string[] {
  const clean: string[] = [];
  for (const pin of pins) {
    const path = pin.trim();
    if (!path || clean.includes(path)) continue;
    clean.push(path);
    if (clean.length >= PINS_LIMIT) break;
  }
  current = Object.freeze(clean);
  try {
    storage()?.setItem(PINS_KEY, JSON.stringify(clean));
  } catch {
    // The storage may be full or forbidden: the pins stay in the session.
  }
  for (const listener of [...listeners]) listener();
  return current;
}

/** Tells the interface that the pins have changed. */
export function subscribePins(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The pins of the user, as the interface sees them.
 *
 * The subscription is narrow: a row of the tree is redrawn when the pins
 * change, not on every keystroke of the editor.
 */
export function usePins(): readonly string[] {
  return useSyncExternalStore(subscribePins, getPins);
}

/** True when the note is pinned. */
export function isPinned(pins: Pins, path: string): boolean {
  return pins.includes(path);
}

/**
 * The pins with the note pinned or unpinned.
 *
 * The order of the list is kept: a note that is pinned again goes back to the
 * end of the group.
 */
export function togglePinIn(pins: Pins, path: string): string[] {
  if (!path) return [...pins];
  if (pins.includes(path)) return pins.filter((pin) => pin !== path);
  return [...pins, path];
}

/** Pins or unpins the note and writes the pins. */
export function togglePin(path: string): readonly string[] {
  return setPins(togglePinIn(current, path));
}

/**
 * The notes of the pins, in the order of the pins.
 *
 * The notes that are not pinned any more (they were deleted) are dropped.
 */
export function pinnedNotes<T extends { path: string }>(
  notes: readonly T[],
  pins: Pins,
): T[] {
  const byPath = new Map(notes.map((note) => [note.path, note]));
  const pinned: T[] = [];
  for (const pin of pins) {
    const note = byPath.get(pin);
    if (note) pinned.push(note);
  }
  return pinned;
}

/**
 * The notes of the tree, split into the pinned notes and the other ones.
 *
 * The pinned notes keep their place in the tree as well: the group of the pins
 * is a copy at the top, not a move.
 */
export function partitionPins<T extends { path: string }>(
  notes: readonly T[],
  pins: Pins,
): { pinned: T[]; rest: T[] } {
  const set = new Set(pins);
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const note of notes) {
    if (set.has(note.path)) pinned.push(note);
    else rest.push(note);
  }
  return { pinned, rest };
}

/**
 * The notes of the tree that are pinned, taken from the nodes of the vault.
 *
 * The pins that point at a note of the vault are kept in the order of the
 * pins; the others are ignored.
 */
export function pinnedNodes(files: readonly Node[], pins: Pins): Node[] {
  return pinnedNotes(files, pins);
}
