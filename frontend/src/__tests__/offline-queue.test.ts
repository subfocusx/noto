// The queue of the writes that wait for the connection.
//
// A write that fails because the backend cannot be reached must not be lost:
// it waits in the outbox of the browser and it is replayed when the
// connection comes back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { clearOutbox, listOutboxEntries, type OutboxEntry } from '../lib/sync/outbox';
import {
  OfflineQueue,
  setPendingSyncPublisher,
  type OutboxStorage,
} from '../core/sync/offlineQueue';
import { createOpenVaultService } from '../core/vault/vaultService';
import { appStore } from '../core/store/appStore';
import { installOfflineQueuePublisher } from '../core/store/offlineQueue';

/** A storage of the queue that lives in the memory of the test. */
function memoryStorage(): OutboxStorage & { entries: OutboxEntry[] } {
  const entries: OutboxEntry[] = [];
  return {
    entries,
    put: async (entry) => {
      const index = entries.findIndex((item) => item.id === entry.id);
      if (index >= 0) entries[index] = entry;
      else entries.push(entry);
    },
    list: async () => entries.slice(),
    remove: async (id) => {
      const index = entries.findIndex((item) => item.id === id);
      if (index >= 0) entries.splice(index, 1);
    },
  };
}

/** A write that waits. */
function write(path: string): Parameters<OfflineQueue['enqueue']>[0] {
  return { kind: 'saveNote', path, payload: JSON.stringify({ path, content: 'x' }), codec: 'json' };
}

beforeEach(async () => {
  localStorage.clear();
  await clearOutbox().catch(() => undefined);
  setPendingSyncPublisher(null);
  appStore.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setPendingSyncPublisher(null);
});

describe('the queue of the writes that wait', () => {
  it('queues a write when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const service = createOpenVaultService();

    await expect(service.saveNote('notes/a.md', 'hello', 1)).rejects.toThrow();

    const entries = await listOutboxEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('saveNote');
    expect(entries[0]?.path).toBe('notes/a.md');
    expect(JSON.parse(entries[0]?.payload ?? '{}')).toEqual({
      path: 'notes/a.md',
      content: 'hello',
      revision: 1,
    });
  });

  it('replays the queue in the order when the connection returns', async () => {
    const queue = new OfflineQueue(memoryStorage());
    await queue.enqueue(write('a.md'));
    await queue.enqueue(write('b.md'));
    await queue.enqueue(write('c.md'));

    const sent: string[] = [];
    const result = await queue.flush(async (queued) => {
      sent.push(queued.path);
    });

    expect(sent).toEqual(['a.md', 'b.md', 'c.md']);
    expect(result.sent).toBe(3);
    expect(result.failed).toBeNull();
    expect(await queue.count()).toBe(0);
  });

  it('keeps a write that fails again and blocks the next one', async () => {
    const queue = new OfflineQueue(memoryStorage());
    await queue.enqueue(write('a.md'));
    await queue.enqueue(write('b.md'));
    await queue.enqueue(write('c.md'));

    const sent: string[] = [];
    const result = await queue.flush(async (queued) => {
      if (queued.path === 'b.md') throw new Error('the server is still down');
      sent.push(queued.path);
    });

    expect(sent).toEqual(['a.md']);
    expect(result.failed?.path).toBe('b.md');
    expect(result.remaining).toBe(2);
    expect((await queue.list()).map((queued) => queued.path)).toEqual(['b.md', 'c.md']);
  });

  it('survives a reload of the page', async () => {
    const queue = new OfflineQueue();
    await queue.enqueue(write('notes/a.md'));

    // A reload: the page comes back with a new module and a new queue, but
    // the database of the browser is the same.
    vi.resetModules();
    const reloaded = await import('../core/sync/offlineQueue');

    expect(await reloaded.offlineQueue.count()).toBe(1);
    expect((await reloaded.offlineQueue.list()).map((queued) => queued.path)).toEqual([
      'notes/a.md',
    ]);
  });

  it('publishes the number of the writes that wait', async () => {
    const counts: number[] = [];
    setPendingSyncPublisher((pending) => counts.push(pending));
    const queue = new OfflineQueue(memoryStorage());

    await queue.enqueue(write('a.md'));
    expect(counts[counts.length - 1]).toBe(1);

    await queue.enqueue(write('b.md'));
    expect(counts[counts.length - 1]).toBe(2);

    await queue.flush(async () => undefined);
    expect(counts[counts.length - 1]).toBe(0);
  });

  it('publishes the number of the writes that wait in the store', async () => {
    installOfflineQueuePublisher();
    const queue = new OfflineQueue(memoryStorage());
    const pending = (): number | undefined =>
      (appStore.getSnapshot().env as { pendingSync?: number }).pendingSync;

    await queue.enqueue(write('a.md'));
    expect(pending()).toBe(1);

    await queue.flush(async () => undefined);
    expect(pending()).toBe(0);
  });
});
