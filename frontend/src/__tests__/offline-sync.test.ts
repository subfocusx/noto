// The replay of the queue of the writes.
//
// The monitor of the connection knows when the backend answers again: the
// writes that wait are replayed at that moment, one by one and in the order
// they were made.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { clearOutbox } from '../lib/sync/outbox';
import { HealthMonitor } from '../core/connection/healthMonitor';
import { offlineQueue, setPendingSyncPublisher } from '../core/sync/offlineQueue';
import { startOfflineReplay } from '../core/sync/offlineReplay';

beforeEach(async () => {
  localStorage.clear();
  await clearOutbox().catch(() => undefined);
  setPendingSyncPublisher(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setPendingSyncPublisher(null);
});

/** A monitor that never probes by itself. */
function makeMonitor(): HealthMonitor {
  return new HealthMonitor({
    probe: async () => undefined,
    intervalMs: 600_000,
    failureIntervalMs: 600_000,
    maxFailureIntervalMs: 600_000,
  });
}

describe('the replay of the queue', () => {
  it('replays the writes when the connection comes back', async () => {
    const monitor = makeMonitor();
    const sent: string[] = [];
    const stop = startOfflineReplay(monitor, async (queued) => {
      sent.push(queued.path);
    });

    await offlineQueue.enqueue({
      kind: 'saveNote',
      path: 'notes/a.md',
      payload: JSON.stringify({ path: 'notes/a.md', content: 'x' }),
      codec: 'json',
    });
    expect(await offlineQueue.count()).toBe(1);

    await monitor.check();

    await vi.waitFor(() => {
      expect(sent).toEqual(['notes/a.md']);
    });
    expect(await offlineQueue.count()).toBe(0);
    stop();
  });

  it('sends the writes in the order they were made', async () => {
    const monitor = makeMonitor();
    const sent: string[] = [];
    const stop = startOfflineReplay(monitor, async (queued) => {
      sent.push(queued.path);
    });

    for (const path of ['a.md', 'b.md', 'c.md']) {
      await offlineQueue.enqueue({
        kind: 'saveNote',
        path,
        payload: JSON.stringify({ path, content: 'x' }),
        codec: 'json',
      });
    }

    await monitor.check();

    await vi.waitFor(() => {
      expect(sent).toEqual(['a.md', 'b.md', 'c.md']);
    });
    stop();
  });

  it('keeps a write that fails again and stops the replay', async () => {
    const monitor = makeMonitor();
    const sent: string[] = [];
    const stop = startOfflineReplay(monitor, async (queued) => {
      if (queued.path === 'b.md') throw new Error('the server is still down');
      sent.push(queued.path);
    });

    for (const path of ['a.md', 'b.md', 'c.md']) {
      await offlineQueue.enqueue({
        kind: 'saveNote',
        path,
        payload: JSON.stringify({ path, content: 'x' }),
        codec: 'json',
      });
    }

    await monitor.check();

    await vi.waitFor(() => {
      expect(sent).toEqual(['a.md']);
    });
    expect(await offlineQueue.count()).toBe(2);
    stop();
  });

  it('does not replay while the backend does not answer', async () => {
    const monitor = new HealthMonitor({
      probe: async () => {
        throw new Error('the backend is down');
      },
      intervalMs: 600_000,
      failureIntervalMs: 600_000,
      maxFailureIntervalMs: 600_000,
    });
    const sent: string[] = [];
    const stop = startOfflineReplay(monitor, async (queued) => {
      sent.push(queued.path);
    });

    await offlineQueue.enqueue({
      kind: 'saveNote',
      path: 'a.md',
      payload: JSON.stringify({ path: 'a.md', content: 'x' }),
      codec: 'json',
    });

    await monitor.check();
    expect(monitor.getState()).toBe('unreachable');
    expect(sent).toEqual([]);
    expect(await offlineQueue.count()).toBe(1);
    stop();
  });
});
