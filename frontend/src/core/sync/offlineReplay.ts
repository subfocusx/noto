// The replay of the queue of the writes that wait.
//
// The monitor of the connection knows when the backend answers again: the
// queue is replayed at that moment. The writes leave the queue one by one, in
// the order they were made, and a write that fails stays in the queue.
//
// The module is the glue between the connection and the queue; it knows
// neither the store nor the notes.
import type { ConnectionState } from '../connection/types';
import {
  offlineQueue,
  publishPendingSync,
  type FlushResult,
  type OfflineSender,
} from './offlineQueue';
import { sendOfflineWrite } from './offlineSender';

/** The part of the monitor the replay needs. */
export interface ConnectionHost {
  /** Adds a listener of the state of the connection. */
  addOnChange(listener: (state: ConnectionState) => void): () => void;
  /** The state of the connection as it is known now. */
  getState(): ConnectionState;
}

/** Sends the writes that wait to the backend. */
export function flushOfflineQueue(sender: OfflineSender = sendOfflineWrite): Promise<FlushResult> {
  return offlineQueue.flush(sender);
}

/**
 * Starts the replay of the queue.
 *
 * The queue is replayed when the connection comes back. It is also replayed
 * right away when the connection is already there: the writes of the last
 * session must not wait for the next change of the state.
 *
 * @returns the function that stops the replay.
 */
export function startOfflineReplay(
  monitor: ConnectionHost,
  sender: OfflineSender = sendOfflineWrite,
): () => void {
  const replay = (): void => {
    void flushOfflineQueue(sender);
  };
  const stop = monitor.addOnChange((state) => {
    if (state === 'connected') replay();
  });
  // The number of the writes that wait is published at once: the interface
  // shows it, even before the first probe of the connection.
  void offlineQueue
    .count()
    .then(publishPendingSync)
    .catch(() => undefined);
  if (monitor.getState() === 'connected') replay();
  return stop;
}
