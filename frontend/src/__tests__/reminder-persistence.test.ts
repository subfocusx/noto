// The persistence of the reminders.
//
// A reminder belongs to the user of this browser: it must survive a reload of
// the page. The delivery is local — there is no server that pushes the
// reminders — so a reminder fires when the application is open.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReminder, loadReminders } from '../core/reminders/types';
import { loadNotifications } from '../core/notifications/persistence';
import { startReminderWatcher } from '../core/reminders/watcher';
import { appStore } from '../core/store/appStore';

/** The day of today, as `YYYY-MM-DD`, in the time of the machine. */
function dayOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

beforeEach(() => {
  localStorage.clear();
  appStore.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the reminders of the browser', () => {
  it('keeps a reminder after a reload', () => {
    appStore.actions.addReminder(createReminder('2026-10-24', '18:00', 'Standup'));

    // A reload: the memory of the page is gone, the storage of the browser
    // is not.
    const restored = loadReminders();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.title).toBe('Standup');
    expect(restored[0]?.day).toBe('2026-10-24');
    expect(restored[0]?.time).toBe('18:00');
  });

  it('fires a reminder that is due only once', () => {
    vi.useFakeTimers();
    appStore.actions.addReminder(createReminder(dayOf(new Date()), '00:00', 'Standup'));

    const stop = startReminderWatcher();
    expect(appStore.getSnapshot().ui.notifications).toHaveLength(1);
    expect(appStore.getSnapshot().ui.reminders).toHaveLength(0);

    vi.advanceTimersByTime(60_000);
    expect(appStore.getSnapshot().ui.notifications).toHaveLength(1);

    // The reminder left the storage of the browser when it fired: a new
    // session does not announce it a second time.
    expect(loadReminders()).toHaveLength(0);
    stop();
  });

  it('does not announce a reminder twice after a reload', () => {
    appStore.actions.addReminder(createReminder(dayOf(new Date()), '00:00', 'Standup'));
    const stop = startReminderWatcher();
    expect(appStore.getSnapshot().ui.notifications).toHaveLength(1);
    stop();

    // The page comes back: the reminder is gone from the storage, so the new
    // watcher finds nothing to announce. The notification of the moment that
    // fired is still there — it is a fact about the work of the user.
    appStore.reset();
    const written = loadNotifications().length;
    const again = startReminderWatcher();
    expect(loadNotifications()).toHaveLength(written);
    expect(appStore.getSnapshot().ui.reminders).toHaveLength(0);
    again();
  });

  it('keeps a reminder whose moment has not come', () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    appStore.actions.addReminder(createReminder(dayOf(tomorrow), '00:00', 'Later'));

    const stop = startReminderWatcher();
    expect(appStore.getSnapshot().ui.notifications).toHaveLength(0);
    expect(loadReminders()).toHaveLength(1);
    stop();
  });
});
