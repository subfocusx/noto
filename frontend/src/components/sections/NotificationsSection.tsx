// The notifications section of the left column.
//
// The section answers one question: "what did the application tell me?". It
// shows the events of the session — a save that failed, a conflict with the
// version of the server, a storage that was migrated — the newest first.
//
// The list lives in the store of the application (see
// `../../core/notifications/types`), so the badge of the rail and this section
// always show the same notifications.
import { useAppActions, useAppState } from '../../core/store/hooks';
import { countUnread, type Notification } from '../../core/notifications/types';
import { formatNotificationTime, NOTIFICATION_LABELS } from '../../core/notifications/format';
import { Icon } from '../../ui/icons';

/** The name of the button that opens the note of a notification. */
const OPEN_NOTE = 'Open the note';

/** The name of the button that removes a notification from the list. */
const DISMISS = 'Dismiss';

interface NotificationEntryProps {
  /** The notification the entry shows. */
  item: Notification;
  /** Called when the user has read the notification. */
  onRead(id: string): void;
  /** Called when the user asks for the note of the notification. */
  onOpen(path: string): void;
  /** Called when the user removes the notification from the list. */
  onDismiss(id: string): void;
}

/**
 * One notification of the list.
 *
 * The entry is a button: a click on it says that the notification has been
 * read. The two actions of the entry (open the note, dismiss) stand beside
 * the text, so they are never nested inside the button of the entry.
 */
function NotificationEntry(props: NotificationEntryProps) {
  const { item } = props;
  const path = item.path;

  return (
    <li class={item.read ? 'notification-item' : 'notification-item is-unread'}>
      <button type="button" class="notification-main" onClick={() => props.onRead(item.id)}>
        <span
          class={`notification-mark notification-mark-${item.kind}`}
          role="img"
          aria-label={NOTIFICATION_LABELS[item.kind]}
        />
        <span class="notification-text">
          <span class="notification-title">{item.title}</span>
          {item.body ? <span class="notification-body">{item.body}</span> : null}
        </span>
        <span class="notification-time">{formatNotificationTime(item.createdAt)}</span>
      </button>

      <div class="notification-actions">
        {path ? (
          <button
            type="button"
            class="q9-button q9-button-quiet"
            onClick={() => props.onOpen(path)}
          >
            {OPEN_NOTE}
          </button>
        ) : null}
        <button
          type="button"
          class="icon-button"
          aria-label={DISMISS}
          title={DISMISS}
          onClick={() => props.onDismiss(item.id)}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    </li>
  );
}

/**
 * The notifications of the session.
 *
 * The section reads the list from the store and writes back through the
 * actions of the store, so every other part of the application (the badge of
 * the rail, the plugins) sees the same list.
 */
export function NotificationsSection() {
  const state = useAppState();
  const actions = useAppActions();
  const list = state.ui.notifications;
  const unread = countUnread(list);

  return (
    <section class="column-section" aria-label="Notifications">
      <header class="column-header section-header">
        <span class="section-header-title">Notifications</span>
        <span class="section-header-count">{unread} unread</span>
      </header>

      <div class="column-body">
        <div class="notifications-toolbar">
          <button
            type="button"
            class="q9-button q9-button-quiet"
            disabled={unread === 0}
            onClick={() => actions.markAllNotificationsRead()}
          >
            Mark all as read
          </button>
          <button
            type="button"
            class="q9-button q9-button-quiet"
            disabled={list.length === 0}
            onClick={() => actions.clearNotifications()}
          >
            Clear all
          </button>
        </div>

        {list.length === 0 ? (
          <p class="section-hint">
            No notification yet. The application tells you here when something needs your
            attention.
          </p>
        ) : (
          <ul class="notifications-list">
            {list.map((item) => (
              <NotificationEntry
                key={item.id}
                item={item}
                onRead={(id) => actions.markNotificationRead(id)}
                onOpen={(path) => void actions.openNote(path)}
                onDismiss={(id) => actions.dismissNotification(id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
