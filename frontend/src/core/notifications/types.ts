// The model of the notifications.
//
// A notification is what the application tells the user: a save that failed, a
// version that conflicts with the one of the server, a storage that was
// migrated. The model is deliberately small and pure: it holds the data, it
// never touches the DOM and it never talks to the backend.
//
// The list lives in the store of the application (`../store`), so the rail, the
// section of the notifications and the plugins always see the same list.
//
// The list is also written in `localStorage` (see `./persistence.ts`): a
// notification is a fact about the work of the user, and it must survive a
// reload of the page — the state of the reading survives it as well.
import { saveNotifications } from './persistence';

/** The kind of a notification: it decides the colour of the entry. */
export type NotificationKind = 'info' | 'success' | 'warning' | 'error';

/**
 * One notification.
 *
 * The model is a plain object: it can be stored, compared and shown without
 * any other dependency.
 */
export interface Notification {
  /** The identifier of the notification; it is unique inside the session. */
  id: string;
  /** The kind of the notification. */
  kind: NotificationKind;
  /** The short sentence that names the event. */
  title: string;
  /** The optional explanation of the event. */
  body?: string;
  /** The moment of the event, in ISO 8601. */
  createdAt: string;
  /** True when the user has already seen the notification. */
  read: boolean;
  /** The path of the note the notification is about, if any. */
  path?: string;
}

/**
 * The biggest number of the notifications.
 *
 * The oldest entries fall out of the list: the notifications of a long session
 * must not grow without a bound.
 */
export const NOTIFICATION_LIMIT = 50;

/** The counter of the identifiers; it makes the identifiers unique. */
let counter = 0;

/**
 * Builds the identifier of a notification.
 *
 * The time, a counter and a random part are enough: the identifier must be
 * unique even when the list was restored from the storage of the browser.
 */
export function newNotificationId(): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `n${Date.now().toString(36)}-${counter.toString(36)}-${random}`;
}

/** The data a caller gives to build a notification. */
export interface NotificationInput {
  /** The kind of the notification. */
  kind: NotificationKind;
  /** The short sentence that names the event. */
  title: string;
  /** The optional explanation of the event. */
  body?: string;
  /** The path of the note the notification is about, if any. */
  path?: string;
}

/**
 * Builds a notification.
 *
 * The notification is created unread: the user has not seen it yet.
 */
export function createNotification(input: NotificationInput): Notification {
  return {
    id: newNotificationId(),
    kind: input.kind,
    title: input.title,
    body: input.body,
    createdAt: new Date().toISOString(),
    read: false,
    path: input.path,
  };
}

/**
 * Puts a notification at the head of the list.
 *
 * The newest comes first and the list never grows beyond
 * {@link NOTIFICATION_LIMIT}. The new list is written in the storage of the
 * browser: the notification survives a reload of the page.
 */
export function pushNotification(
  list: Notification[],
  notification: Notification,
): Notification[] {
  const next = [notification, ...list.filter((item) => item.id !== notification.id)];
  const limited = next.slice(0, NOTIFICATION_LIMIT);
  saveNotifications(limited);
  return limited;
}

/** Marks one notification as read. */
export function markNotificationRead(list: Notification[], id: string): Notification[] {
  let changed = false;
  const next = list.map((item) => {
    if (item.id !== id || item.read) return item;
    changed = true;
    return { ...item, read: true };
  });
  if (!changed) return list;
  saveNotifications(next);
  return next;
}

/** Marks every notification as read. */
export function markAllNotificationsRead(list: Notification[]): Notification[] {
  let changed = false;
  const next = list.map((item) => {
    if (item.read) return item;
    changed = true;
    return { ...item, read: true };
  });
  if (!changed) return list;
  saveNotifications(next);
  return next;
}

/** Removes one notification from the list. */
export function dismissNotification(list: Notification[], id: string): Notification[] {
  const next = list.filter((item) => item.id !== id);
  if (next.length === list.length) return list;
  saveNotifications(next);
  return next;
}

/** Removes every notification from the list. */
export function clearNotifications(): Notification[] {
  saveNotifications([]);
  return [];
}

/** The number of the notifications the user has not read yet. */
export function countUnread(list: Notification[]): number {
  return list.reduce((total, item) => (item.read ? total : total + 1), 0);
}
