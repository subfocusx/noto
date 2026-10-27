import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { RightColumn, RIGHT_COLUMN_OUTLINE_ID } from '../components/RightColumn';

function panels() {
  return [
    { id: 'activity', title: 'Activity', render: () => <p>the activity panel</p> },
    { id: 'tags', title: 'Tags', render: () => <p>the tags panel</p> },
  ];
}

describe('the right column of the application', () => {
  it('shows the core of the application and the plugins as peers', () => {
    render(
      <RightColumn
        outline={<p>the outline of the note</p>}
        panels={panels()}
        activeId={RIGHT_COLUMN_OUTLINE_ID}
        onSelect={() => {}}
      />,
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Outline', 'Activity', 'Tags']);
    expect(screen.getByText('the outline of the note')).toBeTruthy();
  });

  it('shows the panel that is open', () => {
    render(
      <RightColumn
        outline={<p>the outline of the note</p>}
        panels={panels()}
        activeId="tags"
        onSelect={() => {}}
      />,
    );

    expect(screen.getByText('the tags panel')).toBeTruthy();
    expect(screen.queryByText('the outline of the note')).toBeNull();
  });

  it('falls back to the core when the panel of a plugin is gone', () => {
    render(
      <RightColumn
        outline={<p>the outline of the note</p>}
        panels={panels()}
        activeId="a-plugin-that-was-disabled"
        onSelect={() => {}}
      />,
    );

    expect(screen.getByText('the outline of the note')).toBeTruthy();
  });

  it('asks the shell to open another panel', () => {
    const onSelect = vi.fn();
    render(
      <RightColumn
        outline={<p>the outline of the note</p>}
        panels={panels()}
        activeId={RIGHT_COLUMN_OUTLINE_ID}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(onSelect).toHaveBeenCalledWith('activity');
  });

  it('names the panel that is open for the screen reader', () => {
    render(
      <RightColumn
        outline={<p>the outline of the note</p>}
        panels={panels()}
        activeId="activity"
        onSelect={() => {}}
      />,
    );

    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('noto-right-tab-activity');
  });
});
