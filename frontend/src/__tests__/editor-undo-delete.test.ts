import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UNDO_DELETE_TIMEOUT_MS,
  createUndoDeleteController,
} from '../core/editor/undoDelete';

describe('the undo of a deletion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers the deleted note', () => {
    const controller = createUndoDeleteController();
    controller.offer({ path: 'a.md', name: 'a.md' });
    expect(controller.current()).toEqual({ path: 'a.md', name: 'a.md' });
  });

  it('keeps the offer for five seconds', () => {
    const controller = createUndoDeleteController();
    controller.offer({ path: 'a.md', name: 'a.md' });
    vi.advanceTimersByTime(UNDO_DELETE_TIMEOUT_MS - 1);
    expect(controller.current()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(controller.current()).toBeNull();
  });

  it('gives the note back when the user undoes the deletion', () => {
    const controller = createUndoDeleteController();
    controller.offer({ path: 'a.md', name: 'a.md' });
    expect(controller.undo()).toEqual({ path: 'a.md', name: 'a.md' });
    expect(controller.current()).toBeNull();
  });

  it('does not restore anything when there was no offer', () => {
    const controller = createUndoDeleteController();
    expect(controller.undo()).toBeNull();
  });

  it('tells the subscribers about the offer and about its end', () => {
    const controller = createUndoDeleteController();
    const seen: (string | null)[] = [];
    const off = controller.subscribe((offer) => seen.push(offer?.path ?? null));

    controller.offer({ path: 'a.md', name: 'a.md' });
    vi.advanceTimersByTime(UNDO_DELETE_TIMEOUT_MS);
    controller.offer({ path: 'b.md', name: 'b.md' });
    off();
    controller.dismiss();

    expect(seen).toEqual(['a.md', null, 'b.md']);
  });

  it('replaces the offer of the first deletion', () => {
    const controller = createUndoDeleteController();
    controller.offer({ path: 'a.md', name: 'a.md' });
    controller.offer({ path: 'b.md', name: 'b.md' });
    expect(controller.current()?.path).toBe('b.md');
  });

  it('reports the offer that expired on its own', () => {
    const expired: string[] = [];
    const controller = createUndoDeleteController({
      onExpire: (offer) => expired.push(offer.path),
    });
    controller.offer({ path: 'a.md', name: 'a.md' });
    vi.advanceTimersByTime(UNDO_DELETE_TIMEOUT_MS);
    expect(expired).toEqual(['a.md']);
  });
});
