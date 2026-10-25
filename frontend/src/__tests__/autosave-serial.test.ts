// Tests of the serialisation of the saves.
//
// The controller must never send two requests of the same note at the same
// time: the second one would travel with the revision of the first one and
// the server would answer with a conflict that the user never caused.
import { describe, expect, it, vi } from 'vitest';
import { createAutosave } from '../lib/autosave';

/** A save that the test can hold and release. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('the serialisation of the saves', () => {
  it('sends one request per note at a time', async () => {
    const gate = deferred<number>();
    const save = vi.fn(async (_path: string, _content: string, _revision: number) => gate.promise);
    const controller = createAutosave({ delay: 0, save });

    controller.setActivePath('a.md');
    controller.markDirty('a.md', 'first', 1);
    // The debounce is zero, so the first request starts right away.
    await new Promise((resolve) => setTimeout(resolve, 5));

    controller.markDirty('a.md', 'second', 1);
    await new Promise((resolve) => setTimeout(resolve, 5));

    // The second edit must not travel while the first one is in flight.
    expect(save).toHaveBeenCalledTimes(1);

    gate.resolve(2);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now the second edit goes out, and it carries the revision of the first
    // answer.
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[2]).toBe(2);
    expect(save.mock.calls[1]?.[1]).toBe('second');
  });

  it('does not send the same content twice', async () => {
    const save = vi.fn(async (_path: string, _content: string, _revision: number) => 3);
    const controller = createAutosave({ delay: 0, save });

    controller.setActivePath('a.md');
    controller.markDirty('a.md', 'the same', 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(save).toHaveBeenCalledTimes(1);

    // The same content again: the controller knows it is on the server.
    controller.markDirty('a.md', 'the same', 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps the saves of two notes apart', async () => {
    const save = vi.fn(async (_path: string, _content: string, revision: number) => revision + 1);
    const controller = createAutosave({ delay: 0, save });

    controller.setActivePath('a.md');
    controller.markDirty('a.md', 'a', 1);
    controller.markDirty('b.md', 'b', 5);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const paths = save.mock.calls.map((call) => call[0]);
    expect(paths).toContain('a.md');
    expect(paths).toContain('b.md');
  });

  it('flushes the pending edit at once', async () => {
    const save = vi.fn(async (_path: string, _content: string, _revision: number) => 4);
    const controller = createAutosave({ delay: 10_000, save });

    controller.setActivePath('a.md');
    controller.markDirty('a.md', 'the text', 1);
    await controller.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toBe('the text');
  });

  it('does not send anything when nothing was edited', async () => {
    const save = vi.fn(async (_path: string, _content: string, _revision: number) => 1);
    const controller = createAutosave({ delay: 0, save });

    controller.setActivePath('a.md');
    await controller.flush();

    expect(save).not.toHaveBeenCalled();
  });
});
