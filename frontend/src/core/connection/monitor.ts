// The single monitor of the connection with the backend.
//
// The store starts the monitor when the application starts and stops it when
// the application is torn down. The monitor itself does not know the store:
// the store knows the monitor.
import { HealthMonitor } from './healthMonitor';

/** The monitor used by the application. */
export const connectionMonitor = new HealthMonitor();
