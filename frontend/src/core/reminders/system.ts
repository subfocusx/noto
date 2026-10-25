// The system notifications of the browser.
//
// The application is a local application that lives in a tab: a reminder that
// comes while the tab is open must be visible even when the window of the
// application is in the background. The browser offers that with the
// Notification API: it shows a native message in the corner of the screen.
//
// The permission can only be asked **in a gesture of the user**: the browser
// refuses a question that comes from a timer. The interface therefore asks
// when the user adds a reminder, and this module only answers the question.

/** The state of the permission of the browser. */
export type SystemNotificationState = 'unsupported' | 'default' | 'granted' | 'denied';

/**
 * The state of the permission of the system notifications.
 *
 * A browser that knows no Notification API answers `unsupported`.
 */
export function systemNotificationState(): SystemNotificationState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** True when the browser will show the system notifications. */
export function canShowSystemNotifications(): boolean {
  return systemNotificationState() === 'granted';
}

/**
 * Asks the browser for the permission.
 *
 * The call must come from a gesture of the user: the browser ignores it
 * otherwise. The answer is `true` when the permission was given.
 */
export async function requestSystemNotifications(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch {
    // The browser refused the question.
    return false;
  }
}

/**
 * Shows a system notification.
 *
 * Nothing happens when the browser does not allow it: the message is still
 * written into the list of the notifications of the application.
 */
export function showSystemNotification(title: string, body: string, tag: string): void {
  if (!canShowSystemNotifications()) return;
  try {
    const notification = new Notification(title, { body, tag });
    // The window comes to the front when the user clicks the message.
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Some browsers refuse a notification that is not bound to a gesture.
  }
}
