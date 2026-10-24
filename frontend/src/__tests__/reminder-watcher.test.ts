// The tests of the watcher of the reminders.
//
// The watcher is the module that fires the reminders of the user: it looks at
// the list of the store, writes a notification when the moment of a reminder
// has come and removes the reminder from the list.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appStore } from '../core/store/appStore';
import { createReminder } from '../core/reminders/types';
import { startReminderWatcher } from '../core/reminders/watcher';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  appStore.reset();
});

/** The day of today, as `YYYY-MM-DD`, in the time of the machine. */
function dayOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

describe('the watcher of the reminders', () => {
  it('fires a reminder whose moment has come', () => {
    appStore.actions.addReminder(createReminder(dayOf(new Date()), '00:00', 'Standup'));

    const stop = startReminderWatcher();

    const notifications = appStore.getSnapshot().ui.notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toBe('Standup');
    expect(appStore.getSnapshot().ui.reminders).toHaveLength(0);
    stop();
  });

  it('keeps a reminder whose moment has not come', () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    appStore.actions.addReminder(createReminder(dayOf(tomorrow), '00:00', 'Later'));

    const stop = startReminderWatcher();

    expect(appStore.getSnapshot().ui.notifications).toHaveLength(0);
    expect(appStore.getSnapshot().ui.reminders).toHaveLength(1);
    stop();
  });

  it('fires a reminder that is added while the watcher runs', () => {
    vi.useFakeTimers();
    const stop = startReminderWatcher();

    appStore.actions.addReminder(createReminder(dayOf(new Date()), '00:00', 'Standup'));
    vi.advanceTimersByTime(15_000);

    expect(appStore.getSnapshot().ui.notifications).toHaveLength(1);
    stop();
  });

  it('fires a reminder only once', () => {
    vi.useFakeTimers();
    appStore.actions.addReminder(createReminder(dayOf(new Date()), '00:00', 'Standup'));
    const stop = startReminderWatcher();

    vi.advanceTimersByTime(60_000);

    expect(appStore.getSnapshot().ui.notifications).toHaveLength(1);
    stop();
  });

  it('shows a system notification when the browser allows it', () => {
    const shown: { title: string; body?: string; tag?: string }[] = [];
    class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, options?: { body?: string; tag?: string }) {
        shown.push({ title, body: options?.body, tag: options?.tag });
      }
      close(): void {
        /* the message closes itself */
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    appStore.actions.addReminder(createReminder(dayOf(new Date()), '00:00', 'Standup'));

    const stop = startReminderWatcher();

    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe('Standup');
    stop();
  });

  it('shows no system notification when the browser refuses it', () => {
    class FakeNotification {
      static permission = 'denied';
      constructor() {
        throw new Error('the browser must not be asked for a notification');
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    appStore.actions.addReminder(createReminder(dayOf(new Date()), '00:00', 'Standup'));

    const stop = startReminderWatcher();

    expect(appStore.getSnapshot().ui.notifications).toHaveLength(1);
    stop();
  });
});
