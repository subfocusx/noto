// The tests of the rail of the sections.
//
// The rail is the narrow column on the left of the window: it holds one icon
// per section and it never disappears. These tests guard its contract: the
// five sections, the name of every button and the single open section.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Rail } from '../components/Rail';
import type { RailProps } from '../components/Rail';
import type { RailSection } from '../core/store/types';
import { Icon } from '../ui/icons';

/** A section of the rail: its id, its name, its letter and its icon. */
interface Section {
  id: RailSection;
  label: string;
  letter: string;
  icon: string;
}

/** The sections of the rail, in the order they are shown. */
const SECTIONS: Section[] = [
  { id: 'explorer', label: 'Explorer', letter: 'E', icon: 'folder' },
  { id: 'search', label: 'Search', letter: 'S', icon: 'search' },
  { id: 'filters', label: 'Filters', letter: 'F', icon: 'tags' },
  { id: 'history', label: 'History', letter: 'H', icon: 'clock' },
  { id: 'trash', label: 'Trash', letter: 'T', icon: 'trash' },
];

/** Renders the rail with the given handlers. */
function renderRail(overrides: Partial<RailProps> = {}) {
  const props: RailProps = {
    section: 'explorer',
    onSelect: () => undefined,
    theme: 'light',
    onToggleTheme: () => undefined,
    onOpenSettings: () => undefined,
    ...overrides,
  };
  const view = render(<Rail {...props} />);
  return { ...view, props };
}

/** The markup of an icon of the registry, for the comparison with the rail. */
function iconMarkup(name: string): string {
  const { container } = render(<Icon name={name} size={17} />);
  return container.querySelector('svg')?.outerHTML ?? '';
}

describe('the rail of the sections', () => {
  it('is a navigation landmark that holds the five sections', () => {
    renderRail();

    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(nav.getAttribute('class')).toBe('rail');
    expect(nav.querySelectorAll('.rail-items .rail-item')).toHaveLength(SECTIONS.length);

    for (const section of SECTIONS) {
      expect(screen.getByRole('button', { name: section.label })).toBeTruthy();
    }
  });

  it('gives every section its name, its letter and its icon', () => {
    renderRail();

    for (const section of SECTIONS) {
      const button = screen.getByTestId(`rail-${section.id}`);
      expect(button.getAttribute('aria-label')).toBe(section.label);
      expect(button.getAttribute('title')).toBe(`${section.label} (${section.letter})`);
      expect(button.querySelector('.rail-letter')?.textContent).toBe(section.letter);
      expect(button.querySelector('svg')?.outerHTML).toBe(iconMarkup(section.icon));
    }
  });

  it('marks the open section, and only it', () => {
    const { container, rerender, props } = renderRail({ section: 'explorer' });

    for (const section of SECTIONS) {
      rerender(<Rail {...props} section={section.id} />);

      const current = container.querySelectorAll('[aria-current="page"]');
      expect(current).toHaveLength(1);
      expect(current[0]?.getAttribute('data-testid')).toBe(`rail-${section.id}`);
    }
  });

  it('calls the selection with the id of the pressed section', () => {
    const onSelect = vi.fn();
    renderRail({ onSelect });

    for (const section of SECTIONS) {
      fireEvent.click(screen.getByTestId(`rail-${section.id}`));
    }

    expect(onSelect.mock.calls.map((call) => call[0])).toEqual(SECTIONS.map((s) => s.id));
  });

  it('offers the other theme and calls the toggle', () => {
    const onToggleTheme = vi.fn();
    const { rerender, props } = renderRail({ theme: 'dark', onToggleTheme });

    const dark = screen.getByTestId('rail-theme');
    expect(dark.getAttribute('aria-label')).toBe('Switch to the light theme');
    fireEvent.click(dark);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);

    rerender(<Rail {...props} theme='light' />);
    const light = screen.getByTestId('rail-theme');
    expect(light.getAttribute('aria-label')).toBe('Switch to the dark theme');
  });

  it('opens the settings of the application', () => {
    const onOpenSettings = vi.fn();
    renderRail({ onOpenSettings });

    const button = screen.getByTestId('rail-settings');
    expect(button.getAttribute('aria-label')).toBe('Settings');
    fireEvent.click(button);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
