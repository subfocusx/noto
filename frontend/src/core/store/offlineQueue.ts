// The publisher of the number of the writes that wait for the connection.
//
// The queue of the writes lives in the core (`../sync/offlineQueue.ts`) and it
// does not know the store: the store installs the publisher and the queue
// tells it how many writes wait.
//
// The field of the state is `env.pendingSync`: the number of the writes that
// wait for the connection ("3 changes wait for the connection").
import { setPendingSyncPublisher } from '../sync/offlineQueue';
import { update } from './state';

/**
 * Publishes the number of the writes that wait into the state.
 *
 * The field is written with a cast: the store owns the type of the state and
 * the field is added there with the rest of the wiring of the outbox.
 */
export function publishPendingSync(pending: number): void {
  update((prev) => ({
    ...prev,
    env: { ...prev.env, pendingSync: pending } as typeof prev.env,
  }));
}

/**
 * Installs the publisher of the number of the writes that wait.
 *
 * The store calls it when the application starts (see `appStore.ts`).
 */
export function installOfflineQueuePublisher(): void {
  setPendingSyncPublisher(publishPendingSync);
}
