import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave, type AutosaveStatus } from '../lib/autosave';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('autosave controller', () => {
  it('debounces the save by 800ms', async () => {
    const save = vi.fn(async () => undefined);
    const controller = createAutosave({ delay: 800, save });

    controller.markDirty('a.md', 'hello', 1);
    expect(save).not.toHaveBeenCalled();
    expect(controller.dirty()).toBe(true);

    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('a.md', 'hello', 1);
  });

  it('collapses rapid edits into a single save', async () => {
    const save = vi.fn(async () => undefined);
    const controller = createAutosave({ delay: 800, save });
    controller.markDirty('a.md', 'a', 1);
    await vi.advanceTimersByTimeAsync(400);
    controller.markDirty('a.md', 'ab', 1);
    await vi.advanceTimersByTimeAsync(400);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('a.md', 'ab', 1);
  });

  it('reports the status transitions', async () => {
    const statuses: AutosaveStatus[] = [];
    const controller = createAutosave({
      delay: 800,
      save: async () => undefined,
      onStatus: (status) => statuses.push(status),
    });
    controller.setActivePath('a.md');
    controller.markDirty('a.md', 'x', 1);
    expect(statuses).toEqual(['idle']);
    await vi.advanceTimersByTimeAsync(800);
    expect(statuses).toEqual(['idle', 'saving', 'saved']);
    expect(controller.dirty()).toBe(false);
  });

  it('reports errors and keeps the note dirty', async () => {
    const controller = createAutosave({
      delay: 800,
      save: async () => {
        throw new Error('offline');
      },
    });
    controller.setActivePath('a.md');
    controller.markDirty('a.md', 'x', 1);
    await vi.advanceTimersByTimeAsync(800);
    expect(controller.status()).toBe('error');
    expect(controller.dirty()).toBe(true);
  });

  it('does not apply the response of a note that is no longer open', async () => {
    let resolveSave: (() => void) | undefined;
    const statuses: AutosaveStatus[] = [];
    const controller = createAutosave({
      delay: 800,
      save: () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
      onStatus: (status) => statuses.push(status),
    });
    controller.setActivePath('a.md');
    controller.markDirty('a.md', 'x', 1);
    await vi.advanceTimersByTimeAsync(800);
    expect(statuses).toContain('saving');

    // The user switches to another note while the save is in flight.
    controller.setActivePath('b.md');
    resolveSave?.();
    await vi.advanceTimersByTimeAsync(1);

    expect(statuses).not.toContain('saved');
    expect(controller.dirty()).toBe(true);
  });

  it('flushes a pending edit immediately', async () => {
    const save = vi.fn(async () => undefined);
    const controller = createAutosave({ delay: 800, save });
    controller.setActivePath('a.md');
    controller.markDirty('a.md', 'x', 1);
    await controller.flush();
    expect(save).toHaveBeenCalledWith('a.md', 'x', 1);
  });

  it('does not send a request when nothing was edited', async () => {
    const save = vi.fn(async () => undefined);
    const controller = createAutosave({ delay: 800, save });
    controller.setActivePath('a.md');
    await controller.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('saves the edited note even when another note is open', async () => {
    const save = vi.fn(async () => undefined);
    const controller = createAutosave({ delay: 800, save });
    controller.setActivePath('a.md');
    controller.markDirty('a.md', 'text of a', 1);
    controller.setActivePath('b.md');
    await controller.flush();
    expect(save).toHaveBeenCalledWith('a.md', 'text of a', 1);
  });

  it('uses the revision returned by the server for the next save', async () => {
    const save = vi.fn(async () => 5);
    const controller = createAutosave({ delay: 800, save });
    controller.setActivePath('a.md');
    controller.markDirty('a.md', 'x', 1);
    await controller.flush();
    expect(save).toHaveBeenLastCalledWith('a.md', 'x', 1);

    controller.markDirty('a.md', 'y', 1);
    await controller.flush();
    expect(save).toHaveBeenLastCalledWith('a.md', 'y', 5);
  });

  it('does not send the same content twice while a save is in flight', async () => {
    let resolveSave: (() => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const controller = createAutosave({ delay: 800, save });
    controller.setActivePath('a.md');
    controller.markDirty('a.md', 'x', 1);
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);

    const flushed = controller.flush();
    expect(save).toHaveBeenCalledTimes(1);
    resolveSave?.();
    await flushed;
    expect(save).toHaveBeenCalledTimes(1);
  });
});
