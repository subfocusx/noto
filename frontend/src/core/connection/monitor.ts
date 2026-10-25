// The single monitor of the connection with the backend.
//
// The store starts the monitor when the application starts and stops it when
// the application is torn down. The monitor itself does not know the store:
// the store knows the monitor.
//
// The monitor is also the signal of the outbox of the writes: the writes that
// could not reach the backend are replayed when the connection comes back
// (see `../sync/offlineReplay.ts`).
import { HealthMonitor } from './healthMonitor';
import { startOfflineReplay } from '../sync/offlineReplay';

/** The monitor used by the application. */
export const connectionMonitor = new HealthMonitor();

/**
 * The replay of the outbox of the writes.
 *
 * It starts with the monitor: the writes that wait are sent as soon as the
 * backend answers again.
 */
export const stopOfflineReplay = startOfflineReplay(connectionMonitor);
