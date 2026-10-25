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
