// The persistence of the notifications.
//
// A notification is a fact about the work of the user: it must survive a
// reload of the page, and the state of the reading must survive it as well.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  countUnread,
  createNotification,
  markNotificationRead,
  pushNotification,
} from '../core/notifications/types';
import { loadNotifications, NOTIFICATIONS_KEY } from '../core/notifications/persistence';
import { appStore } from '../core/store/appStore';

beforeEach(() => {
  localStorage.clear();
  appStore.reset();
});

describe('the notifications of the browser', () => {
  it('keeps a notification after a reload', () => {
    const notification = createNotification({ kind: 'info', title: 'The note was saved' });
    pushNotification([], notification);

    // A reload: the memory of the page is gone, the storage of the browser
    // is not.
    const restored = loadNotifications();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.title).toBe('The note was saved');
    expect(restored[0]?.kind).toBe('info');
  });

  it('keeps a notification that the application wrote', () => {
    appStore.actions.notify({ kind: 'warning', title: 'The save failed' });

    const restored = loadNotifications();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.title).toBe('The save failed');
  });

  it('restores the number of the notifications that were not read', () => {
    const first = createNotification({ kind: 'info', title: 'First' });
    const second = createNotification({ kind: 'info', title: 'Second' });
    let list = pushNotification([], first);
    list = pushNotification(list, second);
    list = markNotificationRead(list, first.id);

    const restored = loadNotifications();
    expect(countUnread(restored)).toBe(1);
    expect(restored.find((item) => item.id === first.id)?.read).toBe(true);
    expect(restored.find((item) => item.id === second.id)?.read).toBe(false);
  });

  it('writes the notifications under their own key', () => {
    const notification = createNotification({ kind: 'success', title: 'Done' });
    pushNotification([], notification);

    const raw = localStorage.getItem(NOTIFICATIONS_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? '[]')).toHaveLength(1);
  });

  it('drops a broken entry instead of breaking the interface', () => {
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify([{ id: 'x' }, 'nonsense']));
    expect(loadNotifications()).toEqual([]);
  });
});
