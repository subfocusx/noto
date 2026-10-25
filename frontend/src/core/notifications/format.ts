// The words of the notifications.
//
// The model of a notification lives in `./types`; this module holds the words
// the interface shows next to it. The two are apart on purpose: the store
// holds the model and it never needs the words, so they stay out of the
// bundle of the application and are loaded with the section that shows them.
import type { NotificationKind } from './types';

/**
 * The key of the label of every kind of notification.
 *
 * The core knows the key, not the text: the section that shows the
 * notifications translates the key (see `../../i18n`).
 */
export const NOTIFICATION_LABEL_KEYS: Record<NotificationKind, string> = {
  info: 'notification.info',
  success: 'notification.success',
  warning: 'notification.warning',
  error: 'common.error',
};

/**
 * The short name of a moment, for the list of the notifications.
 *
 * The name is built from the local time of the day, so the list stays short
 * and readable.
 */
export function formatNotificationTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
