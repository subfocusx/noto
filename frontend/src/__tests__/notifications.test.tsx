// The tests of the notifications section.
//
// The section shows the list of the store and writes back through the actions
// of the store: the tests prepare the state with the store itself and read
// the state back after every action.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { NotificationsSection } from '../components/sections/NotificationsSection';
import type { NotificationKind } from '../core/notifications/types';
import { appStore } from '../core/store/appStore';

afterEach(() => {
  vi.restoreAllMocks();
  appStore.reset();
});

/** Puts a notification into the store and returns its identifier. */
function notify(input: {
  kind: NotificationKind;
  title: string;
  body?: string;
  path?: string;
}): string {
  appStore.actions.notify(input);
  return appStore.getSnapshot().ui.notifications[0].id;
}

/** The entries of the list of the section. */
function entries(container: Element): Element[] {
  return Array.from(container.querySelectorAll('.notifications-list > li'));
}

describe('the notifications section', () => {
  it('shows the notifications of the store, the newest first', () => {
    notify({ kind: 'info', title: 'The first event' });
    notify({ kind: 'error', title: 'The second event', body: 'The note was not saved.' });

    const { container } = render(<NotificationsSection />);

    const items = entries(container);
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('The second event');
    expect(items[0].textContent).toContain('The note was not saved.');
    expect(items[1].textContent).toContain('The first event');
  });

  it('marks the unread notifications and counts them in the header', () => {
    const read = notify({ kind: 'info', title: 'The read event' });
    notify({ kind: 'warning', title: 'The unread event' });
    appStore.actions.markNotificationRead(read);

    const { container } = render(<NotificationsSection />);

    const items = entries(container);
    expect(items[0].classList.contains('is-unread')).toBe(true);
    expect(items[1].classList.contains('is-unread')).toBe(false);
    expect(screen.getByText('1 unread')).toBeTruthy();
  });

  it('marks a notification as read when its entry is clicked', () => {
    const id = notify({ kind: 'error', title: 'The save failed' });

    const { container } = render(<NotificationsSection />);
    expect(entries(container)[0].classList.contains('is-unread')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /The save failed/ }));

    expect(appStore.getSnapshot().ui.notifications[0].read).toBe(true);
    expect(appStore.getSnapshot().ui.notifications[0].id).toBe(id);
    expect(entries(container)[0].classList.contains('is-unread')).toBe(false);
    expect(screen.getByText('0 unread')).toBeTruthy();
  });

  it('removes a notification from the list when it is dismissed', () => {
    notify({ kind: 'info', title: 'The event' });

    render(<NotificationsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(appStore.getSnapshot().ui.notifications).toHaveLength(0);
  });

  it('marks every notification as read', () => {
    notify({ kind: 'info', title: 'The first event' });
    notify({ kind: 'error', title: 'The second event' });

    render(<NotificationsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));

    const list = appStore.getSnapshot().ui.notifications;
    expect(list).toHaveLength(2);
    expect(list.every((item) => item.read)).toBe(true);
  });

  it('clears the list of the notifications', () => {
    notify({ kind: 'info', title: 'The first event' });
    notify({ kind: 'error', title: 'The second event' });

    render(<NotificationsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(appStore.getSnapshot().ui.notifications).toHaveLength(0);
  });

  it('disables the action that clears the list when there is nothing to clear', () => {
    render(<NotificationsSection />);

    const clear = screen.getByRole('button', { name: 'Clear all' }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
  });

  it('shows the hint of an empty list', () => {
    render(<NotificationsSection />);

    expect(
      screen.getByText(
        'No notification yet. The application tells you here when something needs your attention.',
      ),
    ).toBeTruthy();
  });

  it('opens the note of a notification that has a path', () => {
    const open = vi.spyOn(appStore.actions, 'openNote').mockResolvedValue(undefined);
    notify({ kind: 'error', title: 'The save failed', path: 'notes/a.md' });

    render(<NotificationsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the note' }));

    expect(open).toHaveBeenCalledWith('notes/a.md');
  });
});
