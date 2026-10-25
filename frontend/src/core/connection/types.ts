// The state of the connection between the application and the Noto backend.
//
// The browser can be online while the backend is down (the server was
// stopped, the port changed, the machine sleeps). The two facts must not be
// mixed: `online` describes the network of the browser, `ConnectionState`
// describes the reachability of the backend.

/**
 * The reachability of the backend.
 *
 * - `connected`: the backend answered the last health probe;
 * - `connecting`: a probe is running and no answer is known yet;
 * - `unreachable`: the last probe failed and the backend did not answer.
 */
export type ConnectionState = 'connected' | 'connecting' | 'unreachable';

/** The label of the connection state, shown in the tooltip of the indicator. */
export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Backend connected';
    case 'connecting':
      return 'Checking the backend…';
    case 'unreachable':
      return 'The backend is unreachable — click to retry';
  }
}
