// The keyboard shortcuts of the application.
//
// This module is the single source of truth: the keyboard handler of the
// shell, the labels of the command palette and the help dialog all read the
// same list. A shortcut can therefore never be documented in one place and
// implemented in another.
import type { AutosaveStatus } from '../../lib/autosave';

/** The group a shortcut belongs to. */
export type ShortcutGroup = 'Навигация' | 'Редактор' | 'Вид' | 'Файлы' | 'Система';

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
 */
export const SHORTCUTS: ShortcutDef[] = [
  {
    id: 'palette',
    keys: 'Ctrl+K',
    label: 'Открыть палитру команд',
    group: 'Навигация',
  },
  {
    id: 'palette.secondary',
    keys: 'Ctrl+P',
    label: 'Открыть палитру команд (альтернатива)',
    group: 'Навигация',
  },
  {
    id: 'search',
    keys: 'Ctrl+Shift+F',
    label: 'Искать по заметкам',
    group: 'Навигация',
  },
  {
    id: 'shortcutHelp',
    keys: 'Ctrl+/',
    label: 'Показать горячие клавиши',
    group: 'Навигация',
  },
  {
    id: 'settings',
    keys: 'Ctrl+,',
    label: 'Открыть настройки',
    group: 'Система',
  },
  {
    id: 'newNote',
    keys: 'Ctrl+Alt+N',
    label: 'Создать заметку',
    group: 'Файлы',
  },
  {
    id: 'save',
    keys: 'Ctrl+S',
    label: 'Сохранить заметку',
    group: 'Файлы',
  },
  {
    id: 'toggleSidebar',
    keys: 'Ctrl+Alt+B',
    label: 'Свернуть или развернуть панель заметок',
    group: 'Вид',
  },
  {
    id: 'toggleTheme',
    keys: 'Ctrl+Alt+T',
    label: 'Переключить тему',
    group: 'Вид',
  },
  {
    id: 'editor.bold',
    keys: 'Mod+B',
    label: 'Жирный текст',
    group: 'Редактор',
  },
  {
    id: 'editor.italic',
    keys: 'Mod+I',
    label: 'Курсив',
    group: 'Редактор',
  },
  {
    id: 'editor.search',
    keys: 'Mod+F',
    label: 'Поиск по тексту заметки',
    group: 'Редактор',
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
