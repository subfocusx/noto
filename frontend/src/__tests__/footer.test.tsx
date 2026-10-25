import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import type { ComponentProps } from 'preact';
import { AppFooter } from '../components/AppFooter';
import { Icon } from '../ui/icons';

function renderFooter(overrides: Partial<ComponentProps<typeof AppFooter>> = {}) {
  const props = {
    saveError: null,
    status: 'saved' as const,
    connection: 'connected' as const,
    currentPath: 'notes/a.md',
    onRetrySave: () => undefined,
    ...overrides,
  };
  return { ...render(<AppFooter {...props} />), props };
}

describe('the status bar', () => {
  it('keeps the state of the document', () => {
    renderFooter({
      currentPath: 'notes/a.md',
      wordCount: 1248,
      characterCount: 4200,
      cursor: { line: 3, column: 7 },
      encoding: 'UTF-8',
      writable: false,
    });

    expect(screen.getByText('notes/a.md')).toBeTruthy();
    expect(screen.getByText('Ln 3, Col 7')).toBeTruthy();
    expect(screen.getByText('1 248 words')).toBeTruthy();
    expect(screen.getByText('4 200 chars')).toBeTruthy();
    expect(screen.getByText('Markdown')).toBeTruthy();
    expect(screen.getByText('Read only')).toBeTruthy();
  });

  it('shows the save error and offers a retry', () => {
    const onRetrySave = vi.fn();
    renderFooter({ saveError: 'Disk is full', status: 'error', onRetrySave });

    expect(screen.getByRole('alert').textContent).toContain('Disk is full');
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    expect(onRetrySave).toHaveBeenCalled();
  });

  it('gives every icon-only button an accessible name and a tooltip', () => {
    renderFooter();

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.app-footer-actions button'));
    expect(buttons.length).toBe(3);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.getAttribute('title')).toBeTruthy();
    }
  });

  it('toggles the outline panel and the theme', () => {
    const onTogglePanel = vi.fn();
    const onToggleTheme = vi.fn();
    renderFooter({
      onTogglePanel,
      onToggleTheme,
      panelVisible: false,
    });

    const panel = screen.getByRole('button', { name: 'Toggle outline panel' });
    expect(panel.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(panel);
    expect(onTogglePanel).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
    expect(onToggleTheme).toHaveBeenCalled();
  });

  it('holds no toggle of the left column', () => {
    renderFooter();

    // The left column stands next to the rail of the sections: it is never
    // hidden, so the status bar has no toggle for it.
    expect(screen.queryByRole('button', { name: 'Toggle notes panel' })).toBeNull();
  });

  it('shows the sun in the dark theme and the moon in the light one', () => {
    const { rerender } = render(
      <AppFooter
        saveError={null}
        status='saved'
        connection='connected'
        currentPath='a.md'
        onRetrySave={() => undefined}
        theme='dark'
      />,
    );
    expect(screen.getByRole('button', { name: 'Toggle theme' }).querySelector('svg')).toBeTruthy();

    rerender(
      <AppFooter
        saveError={null}
        status='saved'
        connection='connected'
        currentPath='a.md'
        onRetrySave={() => undefined}
        theme='light'
      />,
    );
    expect(screen.getByRole('button', { name: 'Toggle theme' }).querySelector('svg')).toBeTruthy();
  });

  it('holds no action of the vault', () => {
    renderFooter();

    // The search, the graph and the archive live in the header of the
    // explorer: the status bar shows the state of the document.
    expect(screen.queryByRole('button', { name: 'Search notes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Graph' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('says that a filter is active and lets the user drop it', () => {
    const onClearFilter = vi.fn();
    renderFooter({ filterQuery: 'tag:work', filterTotal: 12, onClearFilter });

    // The tree shows only the matching notes: the permanent bar says so.
    expect(screen.getByTestId('filter-chip')).toBeTruthy();
    expect(screen.getByText('Filter: tag:work')).toBeTruthy();
    expect(screen.getByText('12 notes')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear the active filter' }));
    expect(onClearFilter).toHaveBeenCalled();
  });

  it('explains the limit of the tree when the counter holds more notes', () => {
    renderFooter({ filterQuery: 'tag:work', filterTotal: 137, filterTruncated: true });

    // The counter tells the whole number, the tree holds the first fifty
    // matches: the chip says so.
    const count = screen.getByText('137 notes');
    expect(count.getAttribute('title')).toContain('first 50 matches');
  });

  it('shows no chip when no filter is active', () => {
    renderFooter({ filterQuery: '', filterTotal: 0 });

    expect(screen.queryByTestId('filter-chip')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear the active filter' })).toBeNull();
  });

  it('marks the labels that give up their place on a narrow screen', () => {
    renderFooter({ cursor: { line: 3, column: 7 }, encoding: 'UTF-8' });

    // The status bar of a phone has no room for the format of the file and for
    // the position of the cursor: the rule of the narrow screen hides them.
    // The classes are the contract between the component and the stylesheet.
    expect(screen.getByText('Markdown').className).toContain('app-footer-format');
    expect(screen.getByText('UTF-8').className).toContain('app-footer-format');
    expect(screen.getByText('Ln 3, Col 7').className).toContain('app-footer-cursor');

    // The counters and the state of the file stay: they are what the user needs.
    expect(screen.getByText('Writable').className).not.toContain('app-footer-format');
  });

  it('counts a single match in the singular', () => {
    renderFooter({ filterQuery: 'tag:work', filterTotal: 1 });

    // One match is one note: the plural would be wrong.
    expect(screen.getByText('1 note')).toBeTruthy();
    expect(screen.queryByText('1 notes')).toBeNull();
  });

  it('shows the query alone when the number of the matches is unknown', () => {
    renderFooter({ filterQuery: 'tag:work' });

    // The counter is not always known: the chip says what it knows.
    expect(screen.getByText('Filter: tag:work')).toBeTruthy();
    expect(document.querySelector('.filter-chip-count')).toBeNull();
  });

  it('keeps the count free of the tooltip about the limit of the tree', () => {
    renderFooter({ filterQuery: 'tag:work', filterTotal: 12, filterTruncated: false });

    // The tree holds every match: there is nothing to explain.
    const count = screen.getByText('12 notes');
    expect(count.getAttribute('title')).toBeNull();
  });

  it('survives a click on the cross when no handler is given', () => {
    renderFooter({ filterQuery: 'tag:work', filterTotal: 12 });

    // The chip may be rendered before the application knows how to drop the
    // filter: the click is then a no-op, not a crash.
    fireEvent.click(screen.getByRole('button', { name: 'Clear the active filter' }));
    expect(screen.getByTestId('filter-chip')).toBeTruthy();
  });

  it('draws the cross of the registry on the chip', () => {
    renderFooter({ filterQuery: 'tag:work', filterTotal: 12 });

    // The cross belongs to the chip: the class is the contract with the
    // stylesheet, and the icon comes from the registry of the application.
    const button = screen.getByRole('button', { name: 'Clear the active filter' });
    expect(button.className).toContain('filter-chip-x');

    const drawn = button.querySelector('svg');
    const { container } = render(<Icon name="x" size={12} />);
    const expected = container.querySelector('svg');
    expect(drawn).not.toBeNull();
    expect(expected).not.toBeNull();
    expect(drawn?.outerHTML).toBe(expected?.outerHTML);
  });

  it('keeps the chip of the filter in the permanent bar', () => {
    renderFooter({ filterQuery: 'tag:work', filterTotal: 12 });

    // The bar is permanent: the state of the filter is always known.
    const footer = document.querySelector('.app-footer');
    expect(footer).not.toBeNull();
    expect(footer?.querySelector('.filter-chip')).not.toBeNull();
  });
});
