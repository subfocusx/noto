// The keyboard shortcuts of the application.
//
// This module is the single source of truth: the keyboard handler of the
// shell, the labels of the command palette and the help dialog all read the
// same list. A shortcut can therefore never be documented in one place and
// implemented in another.
import type { AutosaveStatus } from '../../lib/autosave';

/** The group a shortcut belongs to. */
export type ShortcutGroup = 'Navigation' | 'Editor' | 'View' | 'Files' | 'System';

/** One keyboard shortcut. */
export interface ShortcutDef {
  /** The stable id of the shortcut. */
  id: string;
  /** The key combination, for example `Ctrl+Shift+F`. */
  keys: string;
  /** What the shortcut does. */
  label: string;
  /** The group of the help dialog. */
  group: ShortcutGroup;
  /** True when the shortcut only works outside of the editor. */
  outsideEditor?: boolean;
}

/**
 * The shortcuts of the application.
 *
 * The contract of the previous releases is preserved: `Ctrl+K` and `Ctrl+P`
 * open the command palette, `Ctrl+Shift+F` opens the search and `Ctrl+S`
 * saves the note.
 *
 * The sections of the rail have their own shortcuts: the letter of the icon
 * is the letter of the key. The trash takes `Ctrl+Alt+D` (the deleted notes),
 * because `Ctrl+Alt+T` has been the theme since the first release.
 */
export const SHORTCUTS: ShortcutDef[] = [
  {
    id: 'palette',
    keys: 'Ctrl+K',
    label: 'Open the command palette',
    group: 'Navigation',
  },
  {
    id: 'palette.secondary',
    keys: 'Ctrl+P',
    label: 'Open the command palette (alternative)',
    group: 'Navigation',
  },
  {
    id: 'search',
    keys: 'Ctrl+Shift+F',
    label: 'Search the notes',
    group: 'Navigation',
  },
  {
    id: 'shortcutHelp',
    keys: 'Ctrl+/',
    label: 'Show the keyboard shortcuts',
    group: 'Navigation',
  },
  {
    id: 'settings',
    keys: 'Ctrl+,',
    label: 'Open the settings',
    group: 'System',
  },
  {
    id: 'section.explorer',
    keys: 'Ctrl+Alt+E',
    label: 'Open the explorer',
    group: 'Navigation',
  },
  {
    id: 'section.search',
    keys: 'Ctrl+Alt+S',
    label: 'Open the search',
    group: 'Navigation',
  },
  {
    id: 'section.filters',
    keys: 'Ctrl+Alt+F',
    label: 'Open the filters',
    group: 'Navigation',
  },
  {
    id: 'section.history',
    keys: 'Ctrl+Alt+H',
    label: 'Open the history',
    group: 'Navigation',
  },
  {
    id: 'section.trash',
    keys: 'Ctrl+Alt+D',
    label: 'Open the trash',
    group: 'Navigation',
  },
  {
    id: 'newNote',
    keys: 'Ctrl+Alt+N',
    label: 'Create a note',
    group: 'Files',
  },
  {
    id: 'save',
    keys: 'Ctrl+S',
    label: 'Save the note',
    group: 'Files',
  },
  {
    id: 'duplicateNote',
    keys: 'Ctrl+D',
    label: 'Duplicate the note',
    group: 'Files',
  },
  {
    id: 'toggleTheme',
    keys: 'Ctrl+Alt+T',
    label: 'Switch the theme',
    group: 'View',
  },
  {
    id: 'editor.bold',
    keys: 'Mod+B',
    label: 'Bold text',
    group: 'Editor',
  },
  {
    id: 'editor.italic',
    keys: 'Mod+I',
    label: 'Italic',
    group: 'Editor',
  },
  {
    id: 'editor.search',
    keys: 'Mod+F',
    label: 'Search in the text of the note',
    group: 'Editor',
  },
];

/** The shortcut with the given id. */
export function shortcutById(id: string): ShortcutDef | undefined {
  return SHORTCUTS.find((shortcut) => shortcut.id === id);
}

/** The keys of a shortcut, ready to be shown to the user. */
export function formatShortcutKeys(id: string): string {
  const shortcut = shortcutById(id);
  if (!shortcut) return '';
  return shortcut.keys
    .split('+')
    .map((part) => {
      if (part === 'Mod') return 'Ctrl';
      return part;
    })
    .join('+');
}

/**
 * Builds the comparable key of a keyboard event.
 *
 * `Mod` stands for `Ctrl` on Windows and Linux and for `Cmd` on macOS, so one
 * definition covers every platform.
 */
export function eventKey(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join('+');
}

/**
 * True when the event matches the combination.
 *
 * `Mod` in the combination matches `Ctrl` or `Meta`.
 */
export function matchesShortcut(event: KeyboardEvent, keys: string): boolean {
  const expected = keys.split('+');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const modifiers = expected.slice(0, -1);
  const last = expected[expected.length - 1];

  const ctrl = event.ctrlKey;
  const meta = event.metaKey;
  const alt = event.altKey;
  const shift = event.shiftKey;

  for (const modifier of modifiers) {
    if (modifier === 'Mod') {
      if (!ctrl && !meta) return false;
    } else if (modifier === 'Ctrl') {
      if (!ctrl) return false;
    } else if (modifier === 'Meta') {
      if (!meta) return false;
    } else if (modifier === 'Alt') {
      if (!alt) return false;
    } else if (modifier === 'Shift') {
      if (!shift) return false;
    }
  }

  // A shortcut without a modifier must not fire while a modifier is held.
  if (modifiers.length === 0 && (ctrl || meta || alt || shift)) return false;

  return last === key;
}

/** The state of the save, used by the help dialog and the status line. */
export interface SaveStatusInfo {
  status: AutosaveStatus;
  label: string;
}
