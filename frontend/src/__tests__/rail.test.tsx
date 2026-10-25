// The tests of the rail of the sections.
//
// The rail is the narrow column on the left of the window: it holds one icon
// per section and it never disappears. These tests guard its contract: the
// sections of the core, the plain name of every button, the groups of the
// rail, the single open section and the badge of the unread notifications.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Rail } from '../components/Rail';
import type { RailProps } from '../components/Rail';
import { RAIL_SECTIONS } from '../core/commands/appCommands';
import { Icon } from '../ui/icons';

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

/** The texts of the text nodes of an element. */
function textNodes(root: Element): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  let node = walker.nextNode();
  while (node) {
    texts.push(node.textContent ?? '');
    node = walker.nextNode();
  }
  return texts;
}

describe('the rail of the sections', () => {
  it('is a navigation landmark that holds the sections of the core', () => {
    renderRail();

    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(nav.getAttribute('class')).toBe('rail');
    expect(nav.querySelectorAll('.rail-items .rail-item')).toHaveLength(RAIL_SECTIONS.length);

    for (const section of RAIL_SECTIONS) {
      expect(screen.getByRole('button', { name: section.title })).toBeTruthy();
    }
  });

  it('gives every section its plain name and its icon', () => {
    renderRail();

    for (const section of RAIL_SECTIONS) {
      const button = screen.getByTestId(`rail-${section.id}`);
      expect(button.getAttribute('aria-label')).toBe(section.title);
      expect(button.getAttribute('title')).toBe(section.title);
      expect(button.querySelector('svg')?.outerHTML).toBe(iconMarkup(section.icon));
    }
  });

  it('shows no letter under the icons', () => {
    const { container } = renderRail();

    expect(container.querySelectorAll('.rail-letter')).toHaveLength(0);

    for (const section of RAIL_SECTIONS) {
      const button = screen.getByTestId(`rail-${section.id}`);
      const title = button.getAttribute('title') ?? '';
      expect(title).not.toMatch(/\(\s*[A-Za-z]\s*\)/);
      // The item holds an icon and nothing that is written.
      for (const text of textNodes(button)) {
        expect(text).not.toMatch(/[A-Za-z]/);
      }
    }
  });

  it('separates the two groups of the sections with one line', () => {
    const { container } = renderRail();

    const separators = container.querySelectorAll('.rail-items .rail-separator');
    expect(separators).toHaveLength(1);
    expect(separators[0]?.getAttribute('aria-hidden')).toBe('true');

    // The line stands between the last section of the notes and the first
    // section of the storage, and it is an item of the list.
    const items = Array.from(container.querySelectorAll('.rail-items > li'));
    const index = items.findIndex((item) => item.querySelector('.rail-separator'));
    expect(index).toBeGreaterThan(0);

    const lastNotes = [...RAIL_SECTIONS].reverse().find((section) => section.group === 'notes');
    const firstStorage = RAIL_SECTIONS.find((section) => section.group === 'storage');
    expect(items[index - 1]?.querySelector('.rail-item')?.getAttribute('data-section')).toBe(
      lastNotes?.id,
    );
    expect(items[index + 1]?.querySelector('.rail-item')?.getAttribute('data-section')).toBe(
      firstStorage?.id,
    );
  });

  it('marks the open section, and only it', () => {
    const { container, rerender, props } = renderRail({ section: 'explorer' });

    for (const section of RAIL_SECTIONS) {
      rerender(<Rail {...props} section={section.id} />);

      const current = container.querySelectorAll('[aria-current="page"]');
      expect(current).toHaveLength(1);
      expect(current[0]?.getAttribute('data-testid')).toBe(`rail-${section.id}`);
    }
  });

  it('calls the selection with the id of the pressed section', () => {
    const onSelect = vi.fn();
    renderRail({ onSelect });

    for (const section of RAIL_SECTIONS) {
      fireEvent.click(screen.getByTestId(`rail-${section.id}`));
    }

    expect(onSelect.mock.calls.map((call) => call[0])).toEqual(RAIL_SECTIONS.map((s) => s.id));
  });

  it('shows no badge when there is nothing unread', () => {
    const { container, rerender, props } = renderRail();

    expect(container.querySelectorAll('.rail-badge')).toHaveLength(0);

    rerender(<Rail {...props} unreadCount={0} />);
    expect(container.querySelectorAll('.rail-badge')).toHaveLength(0);
  });

  it('shows the count of the unread notifications on the notifications item', () => {
    const { container } = renderRail({ unreadCount: 3 });

    const badges = container.querySelectorAll('.rail-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0]?.getAttribute('aria-hidden')).toBe('true');

    const button = screen.getByTestId('rail-notifications');
    expect(button.querySelector('.rail-badge')?.textContent).toBe('3');
    // The badge does not change the name of the button.
    expect(button.getAttribute('aria-label')).toBe('Notifications');
    expect(screen.getByRole('button', { name: 'Notifications' })).toBe(button);
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
