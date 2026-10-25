// The indicator of the connection with the backend.
//
// The indicator lives in the status bar, at the bottom of the window, next to
// the state of the save: it answers at a glance whether the changes of the
// user reach the disk. The dot is the only part of the interface that is
// coloured by state, so it must stay small and quiet.
import type { ConnectionState } from '../types';
import { useT } from '../i18n/useT';

export interface ConnectionIndicatorProps {
  /** The state of the connection with the backend. */
  connection: ConnectionState;
  /** Called when the user asks the application to check the backend again. */
  onRetry?(): void;
}

/** The name of every state, for the tooltip and for the assistive technology. */
const LABELS: Record<ConnectionState, { label: string; title: string }> = {
  connected: { label: 'connection.connected', title: 'connection.connectedTitle' },
  connecting: { label: 'connection.connecting', title: 'connection.connectingTitle' },
  unreachable: {
    label: 'connection.unreachable',
    title: 'connection.unreachableTitle',
  },
};

/**
 * A small round button that shows the state of the connection.
 *
 * The button is a button and not a plain dot, because the state must always be
 * verifiable: a click asks the application to probe the backend again. That is
 * the way out of a lost connection, and it is also the way to check that a
 * backend that was down is up again.
 */
export function ConnectionIndicator(props: ConnectionIndicatorProps) {
  const t = useT();
  const { label, title } = LABELS[props.connection];
  return (
    <button
      type="button"
      class={`conn-dot ${props.connection}`}
      role="status"
      aria-label={t(label)}
      title={t(title)}
      onClick={() => {
        if (!props.onRetry) return;
        props.onRetry();
      }}
    />
  );
}
