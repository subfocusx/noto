// The saved views: named queries with an icon.
//
// A view is a short name for a query of the query language ("Work", "Open
// tasks", "This week"). The views live in `localStorage` under their own key:
// they are a list of the user, not a part of the preferences of the
// application, and they must survive a change of the preferences.
/** A saved view. */
export interface SavedView {
  /** The identifier of the view; it never changes. */
  id: string;
  /** The name of the view, as the user typed it. */
  title: string;
  /** The query of the view. */
  query: string;
  /**
   * The name of the icon of the view.
   *
   * The core does not know the icons: the name is a plain string, and the
   * interface decides what it does with it.
   */
  icon?: string;
}

/** The key of the saved views in `localStorage`. */
export const VIEWS_KEY = 'noto-views-v1';

/** The biggest number of the saved views. */
export const VIEWS_LIMIT = 50;

/**
 * Reads the saved views.
 *
 * The values are validated on read: a broken entry is dropped instead of
 * breaking the interface.
 */
export function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: SavedView[] = [];
    for (const item of parsed) {
      const view = normalizeView(item);
      if (view) out.push(view);
      if (out.length >= VIEWS_LIMIT) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Writes the saved views. */
export function saveViews(views: SavedView[]): void {
  try {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(views.slice(0, VIEWS_LIMIT)));
  } catch {
    // A full or unavailable storage must not break the application.
  }
}

/**
 * Validates one entry of the saved views.
 *
 * The function returns `null` when the entry is broken.
 */
export function normalizeView(value: unknown): SavedView | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const query = typeof raw.query === 'string' ? raw.query.trim() : '';
  if (!id || !title || !query) return null;
  const icon = typeof raw.icon === 'string' ? raw.icon : undefined;
  return icon ? { id, title, query, icon } : { id, title, query };
}

/** Creates a new view with an identifier that does not exist yet. */
export function createView(title: string, query: string, icon?: string): SavedView {
  const view: SavedView = { id: newViewId(), title: title.trim(), query: query.trim() };
  if (icon) view.icon = icon;
  return view;
}

/** Generates an identifier of a new view. */
export function newViewId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `view-${Date.now().toString(36)}-${random}`;
}
