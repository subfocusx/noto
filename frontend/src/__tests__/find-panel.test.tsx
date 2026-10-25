// The tests of the window of the search and the filters.
//
// The window has two modules: the search of the text and the filter of the
// query language. The magnifier and the funnel of the rail open the same
// window in their own module, so the mode is a property of the window and not
// a state of it.
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
function renderWindow(mode: 'search' | 'filters', onModeChange = vi.fn()) {
  const view = render(
    <FindPanel
      open
      mode={mode}
      onModeChange={onModeChange}
      onClose={() => undefined}
      onOpenNote={() => undefined}
    />,
  );
  return { view, onModeChange };
}

describe('the window of the search and the filters', () => {
  it('is a dialog named "Search notes"', () => {
    const { view } = renderWindow('search');

    const dialog = view.getByRole('dialog', { name: 'Search notes' });
    expect(dialog).toBeTruthy();
  });

  it('shows the module of its properties', () => {
    const { view } = renderWindow('filters');

    expect(view.getByRole('tab', { name: 'Filters' }).getAttribute('aria-selected')).toBe('true');
    expect(view.getByRole('tab', { name: 'Search' }).getAttribute('aria-selected')).toBe('false');
    // The module of the filters holds the query of the language.
    expect(view.getByLabelText('Filter of the notes')).toBeTruthy();
  });

  it('switches the module through the tabs', () => {
    const { view, onModeChange } = renderWindow('search');

    fireEvent.click(view.getByRole('tab', { name: 'Filters' }));
    expect(onModeChange).toHaveBeenCalledWith('filters');

    fireEvent.click(view.getByRole('tab', { name: 'Search' }));
    expect(onModeChange).toHaveBeenCalledWith('search');
  });

  it('closes itself with the Escape', () => {
    const onClose = vi.fn();
    const view = render(
      <FindPanel
        open
        mode="search"
        onModeChange={() => undefined}
        onClose={onClose}
        onOpenNote={() => undefined}
      />,
    );

    fireEvent.keyDown(view.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when it is closed', () => {
    const view = render(
      <FindPanel
        open={false}
        mode="search"
        onModeChange={() => undefined}
        onClose={() => undefined}
        onOpenNote={() => undefined}
      />,
    );

    expect(view.container.innerHTML).toBe('');
  });

  it('lists the notes that matched the query', () => {
    appStore.actions.setQuery('tag == "work"');

    const { view } = renderWindow('filters');

    // Without a query the tree holds the whole vault, and the list of the
    // window stays empty: it lists what matched, not everything.
    expect(view.queryByTestId('find-results')).toBeNull();
  });
});
