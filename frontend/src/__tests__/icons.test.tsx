import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { ICON_NAMES, ICONS, Icon, isIconName } from '../ui/icons';

describe('the icon registry', () => {
  it('knows the icons of the interface', () => {
    for (const name of ['folder', 'file-text', 'search', 'trash', 'sun', 'moon'] as const) {
      expect(isIconName(name)).toBe(true);
      expect(ICONS[name]).toBeDefined();
    }
  });

  it('knows the icons of the compact shell', () => {
    for (const name of [
      'copy',
      'network',
      'archive',
      'chevron-up',
      'panel-left',
      'dots-vertical',
      'bookmark',
    ] as const) {
      expect(isIconName(name)).toBe(true);
      expect(ICONS[name]).toBeDefined();
    }
  });

  it('knows exactly the expected names', () => {
    expect(ICON_NAMES).toEqual([
      'archive',
      'bell',
      'bookmark',
      'calendar',
      'chevron-down',
      'chevron-right',
      'chevron-up',
      'chevrons-down-up',
      'chevrons-up-down',
      'circle',
      'clock',
      'command',
      'copy',
      'dots-vertical',
      'file-plus',
      'file-text',
      'filter',
      'folder',
      'folder-open',
      'folder-plus',
      'hash',
      'image',
      'link',
      'lock',
      'lock-open',
      'menu',
      'moon',
      'more-horizontal',
      'move',
      'network',
      'panel-left',
      'panel-right',
      'pencil',
      'plus',
      'puzzle',
      'refresh-cw',
      'rotate-ccw',
      'search',
      'settings',
      'star',
      'sun',
      'tags',
      'trash',
      'upload',
      'x',
    ]);
  });

  it('does not know an unknown name', () => {
    expect(isIconName('definitely-not-an-icon')).toBe(false);
  });

  it('renders a known icon', () => {
    const { container } = render(<Icon name="folder" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to a neutral icon for an unknown name', () => {
    const { container } = render(<Icon name="definitely-not-an-icon" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('gives an accessible name when a label is set', () => {
    const { container } = render(<Icon name="folder" label="Folder" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(svg?.getAttribute('aria-label')).toBe('Folder');
  });

  it('lists the names in a stable order', () => {
    const names = [...ICON_NAMES];
    expect(names).toEqual([...names].sort());
  });
});

describe('the icons of the phase 14', () => {
  const NEW_NAMES = [
    'rotate-ccw',
    'chevrons-down-up',
    'chevrons-up-down',
    'lock',
    'lock-open',
  ] as const;

  it('knows the five new names', () => {
    for (const name of NEW_NAMES) {
      expect(isIconName(name)).toBe(true);
      expect(ICONS[name]).toBeDefined();
    }
  });

  it('draws an svg for every new name', () => {
    for (const name of NEW_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelector('svg')).not.toBeNull();
      unmount();
    }
  });

  it('hides the new icons from the assistive technology when no label is given', () => {
    for (const name of NEW_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('role')).toBeNull();
      unmount();
    }
  });

  it('draws the locked and the unlocked glyph differently', () => {
    const locked = render(<Icon name="lock" />).container.innerHTML;
    const unlocked = render(<Icon name="lock-open" />).container.innerHTML;
    expect(locked).not.toEqual(unlocked);
  });

  it('draws the two double chevron glyphs differently', () => {
    const downUp = render(<Icon name="chevrons-down-up" />).container.innerHTML;
    const upDown = render(<Icon name="chevrons-up-down" />).container.innerHTML;
    expect(downUp).not.toEqual(upDown);
  });

  it('draws every new icon differently from the others', () => {
    const marks = NEW_NAMES.map((name) => ({
      name,
      markup: render(<Icon name={name} />).container.innerHTML,
    }));
    for (const mark of marks) {
      const twins = marks.filter((other) => other.name !== mark.name && other.markup === mark.markup);
      expect(twins.map((twin) => twin.name)).toEqual([]);
    }
  });
});

describe('the glyphs of the whole registry', () => {
  it('draws a different glyph for every name', () => {
    const seen = new Map<string, string>();
    const twins: string[] = [];
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const markup = container.innerHTML;
      unmount();
      const owner = seen.get(markup);
      if (owner === undefined) {
        seen.set(markup, name);
      } else {
        twins.push(`${owner} and ${name}`);
      }
    }
    expect(twins).toEqual([]);
  });
});
