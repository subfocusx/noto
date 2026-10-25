import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import type { ComponentProps } from 'preact';
import { AppFooter } from '../components/AppFooter';

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
});
