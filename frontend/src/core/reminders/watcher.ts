// The watcher of the reminders.
//
// The watcher looks at the list of the reminders of the user and fires the
// ones whose moment has come: the application writes a notification into the
// list of the notifications and shows a system notification of the browser, so
// the message is seen even when the window of the application is in the
// background.
//
// The module is loaded on demand: the shell of the application does not need
// the watcher before the first tick, and a user without reminders never loads
// it at all.
import { appStore } from '../store/appStore';
import { formatReminderMoment, isDue } from './types';
import { showSystemNotification } from './system';

/**
 * How often the watcher looks at the reminders, in milliseconds.
 *
 * The look is cheap (the list of the reminders is short) and the delay of a
 * reminder must not be noticeable.
 */
export const REMINDER_TICK_MS = 15_000;

/**
 * Starts the watcher of the reminders.
 *
 * A reminder that has passed is fired once: the watcher remembers the
 * identifiers it has already fired, so a reminder that stays in the list
 * (because the removal failed) is not announced twice.
 *
 * @returns the function that stops the watcher.
 */
export function startReminderWatcher(): () => void {
  const fired = new Set<string>();

  const check = (): void => {
    const now = Date.now();
    for (const reminder of appStore.getSnapshot().ui.reminders) {
      if (fired.has(reminder.id)) continue;
      if (!isDue(reminder, now)) continue;
      fired.add(reminder.id);
      const title = reminder.title || 'Reminder';
      const body = formatReminderMoment(reminder);
      appStore.actions.notify({ kind: 'info', title, body, path: reminder.path });
      showSystemNotification(title, body, reminder.id);
      appStore.actions.removeReminder(reminder.id);
    }
  };

  check();
  const timer = window.setInterval(check, REMINDER_TICK_MS);
  return () => window.clearInterval(timer);
}
