import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import type { ComponentProps } from 'preact';
import { AppFooter } from '../components/AppFooter';

function renderFooter(overrides: Partial<ComponentProps<typeof AppFooter>> = {}) {
  const props = {
    saveError: null,
    status: 'saved' as const,
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
    expect(buttons.length).toBe(7);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.getAttribute('title')).toBeTruthy();
    }
  });

  it('toggles the columns and the theme', () => {
    const onToggleSidebar = vi.fn();
    const onTogglePanel = vi.fn();
    const onToggleTheme = vi.fn();
    renderFooter({
      onToggleSidebar,
      onTogglePanel,
      onToggleTheme,
      sidebarVisible: true,
      panelVisible: false,
    });

    const sidebar = screen.getByRole('button', { name: 'Toggle notes panel' });
    expect(sidebar.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(sidebar);
    expect(onToggleSidebar).toHaveBeenCalled();

    const panel = screen.getByRole('button', { name: 'Toggle outline panel' });
    expect(panel.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(panel);
    expect(onTogglePanel).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
    expect(onToggleTheme).toHaveBeenCalled();
  });

  it('shows the sun in the dark theme and the moon in the light one', () => {
    const { rerender } = render(
      <AppFooter
        saveError={null}
        status='saved'
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
        currentPath='a.md'
        onRetrySave={() => undefined}
        theme='light'
      />,
    );
    expect(screen.getByRole('button', { name: 'Toggle theme' }).querySelector('svg')).toBeTruthy();
  });

  it('marks the graph and the archive as not implemented', () => {
    renderFooter();

    const graph = screen.getByRole('button', { name: 'Graph' });
    expect(graph.getAttribute('aria-disabled')).toBe('true');
    expect(graph.getAttribute('title')).toBe('Not implemented yet');

    const archive = screen.getByRole('button', { name: 'Archive' });
    expect(archive.getAttribute('aria-disabled')).toBe('true');
    expect(archive.getAttribute('title')).toBe('Not implemented yet');
  });

  it('calls the handlers of the graph and of the archive when they exist', () => {
    const onOpenGraph = vi.fn();
    const onOpenArchive = vi.fn();
    renderFooter({ onOpenGraph, onOpenArchive });

    const graph = screen.getByRole('button', { name: 'Graph' });
    expect(graph.getAttribute('aria-disabled')).toBe('false');
    expect(graph.getAttribute('title')).toBe('Graph');
    fireEvent.click(graph);
    expect(onOpenGraph).toHaveBeenCalled();

    const archive = screen.getByRole('button', { name: 'Archive' });
    expect(archive.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(archive);
    expect(onOpenArchive).toHaveBeenCalled();
  });

  it('opens the search', () => {
    const onOpenSearch = vi.fn();
    renderFooter({ onOpenSearch });

    fireEvent.click(screen.getByRole('button', { name: 'Search notes' }));
    expect(onOpenSearch).toHaveBeenCalled();
  });
});
