// The notifications of the user, in the storage of the browser.
//
// A notification is a fact about the session of the user: a save that failed,
// a conflict, a migration. The user must find it again after a reload of the
// page, and the state of the reading must survive as well: a notification the
// user has read stays read.
//
// The list lives in `localStorage` under its own key, like the reminders and
// the favorites: it belongs to the user of this browser and not to the vault.
import type { Notification, NotificationKind } from './types';

/** The key of the notifications in `localStorage`. */
export const NOTIFICATIONS_KEY = 'noto-notifications-v1';

/** The kinds a notification can have. */
const KINDS: NotificationKind[] = ['info', 'success', 'warning', 'error'];

/**
 * Reads the notifications.
 *
 * The values are validated on read: a broken entry is dropped instead of
 * breaking the interface.
 */
export function loadNotifications(): Notification[] {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Notification[] = [];
    for (const item of parsed) {
      const notification = normalizeNotification(item);
      if (notification) out.push(notification);
    }
    return out;
  } catch {
    return [];
  }
}

/** Writes the notifications. */
export function saveNotifications(list: Notification[]): void {
  try {
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(list));
  } catch {
    // A full or unavailable storage must not break the application.
  }
}

/** Reads a notification out of an unknown value. */
function normalizeNotification(raw: unknown): Notification | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Partial<Notification>;
  if (typeof item.id !== 'string' || !item.id) return null;
  if (!KINDS.includes(item.kind as NotificationKind)) return null;
  if (typeof item.title !== 'string') return null;
  return {
    id: item.id,
    kind: item.kind as NotificationKind,
    title: item.title,
    body: typeof item.body === 'string' ? item.body : undefined,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    read: item.read === true,
    path: typeof item.path === 'string' ? item.path : undefined,
  };
}
