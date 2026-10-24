// The favorites of the user.
//
// The favorites are the notes the user marked for quick access: the rail has a
// section that lists them, and the tree marks them with a star.
//
// The list is a list of the user, not a part of the preferences of the
// application, so it lives in `localStorage` under its own key — like the
// saved views do. The vault on the disk knows nothing about it: a favorite is
// a mark of the interface, and it must survive a reload of the page without
// touching the files of the user.

/** The key of the favorites in `localStorage`. */
export const FAVORITES_KEY = 'noto-favorites-v1';

/** The biggest number of the favorites. */
export const FAVORITES_LIMIT = 200;

/**
 * Reads the favorites.
 *
 * The values are validated on read: a broken entry is dropped instead of
 * breaking the interface.
 */
export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    // A broken or unavailable storage must not break the application.
    return [];
  }
}

/** Writes the favorites. */
export function saveFavorites(paths: string[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(paths.slice(0, FAVORITES_LIMIT)));
  } catch {
    // A full or unavailable storage must not break the application.
  }
}

/**
 * Adds a path to the list of the favorites, or removes it.
 *
 * The list keeps its order: the favorite that was added last comes last.
 */
export function toggleFavorite(paths: string[], path: string): string[] {
  if (isFavorite(paths, path)) {
    return paths.filter((item) => item !== path);
  }
  return [...paths, path];
}

/** True when the path is one of the favorites. */
export function isFavorite(paths: string[], path: string): boolean {
  return paths.includes(path);
}
