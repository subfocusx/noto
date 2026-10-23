import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { RecentNotesPanel } from '../components/RecentNotesPanel';

describe('the panel of the recent notes', () => {
  it('shows the notes of the list and marks the missing ones', () => {
    const view = render(
      <RecentNotesPanel
        paths={['journal/a.md', 'gone.md']}
        knownPaths={['journal/a.md']}
        onOpen={() => undefined}
        onRemove={() => undefined}
      />,
    );

    expect(view.getByText('a.md')).toBeTruthy();
    expect(view.getByText('gone.md')).toBeTruthy();
    const items = view.container.querySelectorAll('.recent-item');
    expect(items).toHaveLength(2);
    expect(items[0]?.className).not.toContain('missing');
    expect(items[1]?.className).toContain('missing');
    expect(view.getByLabelText('Remove gone.md')).toBeTruthy();
  });

  it('expands the section by default', () => {
    const view = render(
      <RecentNotesPanel
        paths={['journal/a.md']}
        knownPaths={['journal/a.md']}
        onOpen={() => undefined}
        onRemove={() => undefined}
      />,
    );

    const toggle = view.getByLabelText('Collapse recent notes');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(view.getByText('Recent')).toBeTruthy();
    expect(view.container.querySelector('.recent-list')).not.toBeNull();
  });

  it('hides the list when the section is collapsed', () => {
    const view = render(
      <RecentNotesPanel
        paths={['journal/a.md']}
        knownPaths={['journal/a.md']}
        onOpen={() => undefined}
        onRemove={() => undefined}
        collapsed
      />,
    );

    const toggle = view.getByLabelText('Expand recent notes');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(view.container.querySelector('.recent-list')).toBeNull();
    expect(view.queryByText('a.md')).toBeNull();
    // The header is still there, so the section can be expanded again.
    expect(view.getByText('Recent')).toBeTruthy();
  });

  it('asks for a toggle when the header is clicked', () => {
    const onToggleCollapsed = vi.fn();
    const view = render(
      <RecentNotesPanel
        paths={['journal/a.md']}
        knownPaths={['journal/a.md']}
        onOpen={() => undefined}
        onRemove={() => undefined}
        onToggleCollapsed={onToggleCollapsed}
      />,
    );

    fireEvent.click(view.getByLabelText('Collapse recent notes'));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('opens and removes a note of the list', () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const view = render(
      <RecentNotesPanel
        paths={['journal/a.md']}
        knownPaths={['journal/a.md']}
        onOpen={onOpen}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(view.getByText('a.md'));
    expect(onOpen).toHaveBeenCalledWith('journal/a.md');

    fireEvent.click(view.getByLabelText('Remove a.md'));
    expect(onRemove).toHaveBeenCalledWith('journal/a.md');
  });
});
