// The indicator of the connection with the backend.
//
// The indicator lives in the header of the explorer, next to the actions of
// the vault: it answers at a glance whether the changes of the user reach the
// disk. The dot is the only part of the interface that is coloured by state,
// so it must stay small and quiet.
import type { ConnectionState } from '../types';

export interface ConnectionIndicatorProps {
  /** The state of the connection with the backend. */
  connection: ConnectionState;
  /** Called when the user asks the application to check the backend again. */
  onRetry?(): void;
}

/** The names of every state, for the tooltip and for the assistive technology. */
const LABELS: Record<ConnectionState, { label: string; title: string }> = {
  connected: { label: 'Backend connected', title: 'Backend connected — click to check again' },
  connecting: { label: 'Checking the backend', title: 'Checking the backend…' },
  unreachable: {
    label: 'The backend is unreachable',
    title: 'The backend is unreachable — click to retry',
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
  const { label, title } = LABELS[props.connection];
  return (
    <button
      type="button"
      class={`conn-dot ${props.connection}`}
      role="status"
      aria-label={label}
      title={title}
      onClick={() => {
        if (!props.onRetry) return;
        props.onRetry();
      }}
    />
  );
}
