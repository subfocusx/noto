// The tests of the floating window of the search and of the filters.
//
// The window does not block the tree behind it: it has no backdrop that
// swallows the clicks, and a click outside of it closes it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import { appStore } from '../core/store/appStore';
import { FindPanel } from '../components/FindPanel';

vi.mock('../api/client', () => ({
  search: vi.fn(async () => []),
}));

afterEach(() => {
  appStore.reset();
  localStorage.clear();
});

/** The window with the given mode. */
function renderWindow(onClose = vi.fn()) {
  const view = render(
    <FindPanel
      open
      mode="search"
      onModeChange={() => undefined}
      onClose={onClose}
      onOpenNote={() => undefined}
    />,
  );
  return { view, onClose };
}

describe('the floating window of the search', () => {
  it('has no backdrop that darkens the tree', () => {
    const { view } = renderWindow();

    const overlay = view.getByRole('dialog', { name: 'Search notes' });
    // The overlay does not paint a backdrop and it does not swallow the
    // clicks: the tree behind it stays clickable.
    expect(overlay.getAttribute('aria-modal')).toBeNull();
    expect(overlay.style.background).toBe('transparent');
    expect(overlay.style.pointerEvents).toBe('none');
  });

  it('keeps the clicks of the window for itself', () => {
    const { view } = renderWindow();

    const window = view.getByRole('dialog', { name: 'Search notes' }).firstElementChild as HTMLElement;
    expect(window.style.pointerEvents).toBe('auto');
  });

  it('closes itself when the user clicks outside of it', () => {
    const { onClose } = renderWindow();

    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close itself when the user clicks inside of it', () => {
    const { view, onClose } = renderWindow();

    fireEvent.mouseDown(view.getByLabelText('Search query'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes itself with the Escape', () => {
    const { view, onClose } = renderWindow();

    fireEvent.keyDown(view.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
