import { describe, expect, it } from 'vitest';
import { SHORTCUTS, formatShortcutKeys, matchesShortcut, shortcutById } from '../core/commands/shortcuts';

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('keyboard shortcuts', () => {
  it('gives every shortcut a unique id', () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every shortcut keys, a label and a group', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.label.length).toBeGreaterThan(0);
      expect(shortcut.group.length).toBeGreaterThan(0);
    }
  });

  it('keeps the shortcuts of the previous releases', () => {
    expect(shortcutById('palette')?.keys).toBe('Ctrl+K');
    // Ctrl+P used to open the palette a second time; it opens the quick
    // file switcher since the phase 20.
    expect(shortcutById('fileSwitcher')?.keys).toBe('Ctrl+P');
    expect(shortcutById('search')?.keys).toBe('Ctrl+Shift+F');
    expect(shortcutById('save')?.keys).toBe('Ctrl+S');
  });

  it('does not give two shortcuts the same combination', () => {
    const combinations = SHORTCUTS.map((shortcut) => shortcut.keys);
    expect(new Set(combinations).size).toBe(combinations.length);
  });

  it('matches a combination with the modifiers', () => {
    expect(matchesShortcut(key({ key: 'k', ctrlKey: true }), 'Ctrl+K')).toBe(true);
    expect(matchesShortcut(key({ key: 'K', ctrlKey: true }), 'Ctrl+K')).toBe(true);
    expect(matchesShortcut(key({ key: 'f', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+F')).toBe(true);
    expect(matchesShortcut(key({ key: 'k' }), 'Ctrl+K')).toBe(false);
    expect(matchesShortcut(key({ key: 'j', ctrlKey: true }), 'Ctrl+K')).toBe(false);
  });

  it('treats Mod as Ctrl or as the meta key', () => {
    expect(matchesShortcut(key({ key: 'b', ctrlKey: true }), 'Mod+B')).toBe(true);
    expect(matchesShortcut(key({ key: 'b', metaKey: true }), 'Mod+B')).toBe(true);
    expect(matchesShortcut(key({ key: 'b' }), 'Mod+B')).toBe(false);
  });

  it('does not fire a combination without a modifier while a modifier is held', () => {
    expect(matchesShortcut(key({ key: 's', ctrlKey: true }), 'S')).toBe(false);
    expect(matchesShortcut(key({ key: 's' }), 'S')).toBe(true);
  });

  it('shows the keys in a readable form', () => {
    expect(formatShortcutKeys('palette')).toBe('Ctrl+K');
    expect(formatShortcutKeys('editor.bold')).toBe('Ctrl+B');
    expect(formatShortcutKeys('missing')).toBe('');
  });
});
