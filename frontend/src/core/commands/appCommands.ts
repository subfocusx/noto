// The commands of the application itself.
//
// The plugins contribute their commands to the same `CommandRegistry`, so the
// command palette shows both kinds at once. The commands of the application
// are registered under the owner `app` and their ids are prefixed with
// `app:` — a plugin may not use that prefix (the registry refuses duplicate
// ids anyway).
import type { CommandLike, CommandRegistry } from './commandRegistry';
import type { RailSection } from '../store/types';

/** The owner of the commands of the application. */
export const APP_COMMAND_OWNER = 'app';

/** The prefix of every command of the application. */
export const APP_COMMAND_PREFIX = 'app:';

/**
 * The group of a section of the rail.
 *
 * The groups are the two halves of the rail: the notes themselves and the life
 * of the storage. The rail draws a separator between them, like the ribbon of
 * Obsidian.
 */
export type RailGroup = 'notes' | 'storage';

/**
 * The sections of the rail, in the order of the rail.
 *
 * The list is the single source of the order: the rail draws the icons in it,
 * the palette lists the commands in it and the keyboard maps the letters of the
 * shortcuts on it.
 *
 * The order follows the work of the user: first the notes themselves (the
 * explorer, the calendar, the search and the selection), then the life of the
 * storage (the history, the notifications and the trash).
 *
 * There is no letter under the icon: the name of the section lives in the
 * accessible name of the button and in its tooltip, like in Obsidian.
 */
export const RAIL_SECTIONS: { id: RailSection; title: string; icon: string; group: RailGroup }[] = [
  { id: 'explorer', title: 'Explorer', icon: 'folder', group: 'notes' },
  { id: 'favorites', title: 'Favorites', icon: 'star', group: 'notes' },
  { id: 'calendar', title: 'Calendar', icon: 'calendar', group: 'notes' },
  { id: 'search', title: 'Search', icon: 'search', group: 'notes' },
  { id: 'filters', title: 'Filters', icon: 'filter', group: 'notes' },
  { id: 'history', title: 'History', icon: 'clock', group: 'storage' },
  { id: 'notifications', title: 'Notifications', icon: 'bell', group: 'storage' },
  { id: 'trash', title: 'Trash', icon: 'trash', group: 'storage' },
];

/**
 * The section of a shortcut of the rail.
 *
 * The ids of the shortcuts are `section.<name>`: the shortcut of the explorer
 * is `section.explorer`.
 */
export function railSectionOfShortcut(shortcutId: string): RailSection | null {
  if (!shortcutId.startsWith('section.')) return null;
  const name = shortcutId.slice('section.'.length);
  const section = RAIL_SECTIONS.find((entry) => entry.id === name);
  return section ? section.id : null;
}

/** The parts of the application the commands act upon. */
export interface AppCommandDeps {
  /** Opens the "new note" dialog. */
  createNote(): void;
  /** Opens the "new folder" dialog. */
  createFolder(): void;
  /** Creates or opens the daily note. */
  dailyNote(): void | Promise<void>;
  /** Opens the search panel. */
  openSearch(): void;
  /** Switches between the light and the dark theme. */
  toggleTheme(): void;
  /** Opens the trash. */
  openTrash(): void;
  /** Renames the note that is currently open. */
  renameNote(): void;
  /** Deletes the note that is currently open. */
  deleteNote(): void;
  /**
   * Copies the note that is currently open.
   *
   * The callback is optional: the shell wires it when the store is ready.
   */
  duplicateNote?(): void | Promise<void>;
  /** Opens the settings of the application. */
  openSettings(): void;
  /** Opens the help of the keyboard shortcuts. */
  openShortcuts(): void;
  /** Opens a section of the left column. */
  openSection(section: RailSection): void;
  /**
   * Opens the quick menu of the storage of the notes.
   *
   * The menu lives in the header of the explorer, so the section is opened
   * with it.
   */
  switchVault?(): void;
  /**
   * Opens every folder of the tree at once.
   *
   * The callback is optional: the shell wires it when the store is ready.
   */
  expandAllFolders?(): void;
  /** Closes every folder of the tree at once. */
  collapseAllFolders?(): void;
}

/** A command of the application, before it is registered. */
export interface AppCommandSpec extends CommandLike {}

/** The list of the commands of the application, in a stable order. */
export function appCommandSpecs(deps: AppCommandDeps): AppCommandSpec[] {
  return [
    {
      id: `${APP_COMMAND_PREFIX}new-note`,
      title: 'New note',
      description: 'Create a new Markdown note',
      run: () => deps.createNote(),
    },
    {
      id: `${APP_COMMAND_PREFIX}new-folder`,
      title: 'New folder',
      description: 'Create a new folder in the library',
      run: () => deps.createFolder(),
    },
    {
      id: `${APP_COMMAND_PREFIX}daily-note`,
      title: 'Daily note',
      description: 'Open (or create) the note of today, YYYY-MM-DD.md',
      run: () => deps.dailyNote(),
    },
    {
      id: `${APP_COMMAND_PREFIX}search`,
      title: 'Search notes',
      description: 'Search across all the notes',
      shortcut: 'Ctrl+Shift+F',
      run: () => deps.openSearch(),
    },
    {
      id: `${APP_COMMAND_PREFIX}toggle-theme`,
      title: 'Toggle theme',
      description: 'Switch between the light and the dark theme',
      run: () => deps.toggleTheme(),
    },
    {
      id: `${APP_COMMAND_PREFIX}rename-note`,
      title: 'Rename note',
      description: 'Rename the note that is open',
      run: () => deps.renameNote(),
    },
    {
      id: `${APP_COMMAND_PREFIX}delete-note`,
      title: 'Delete note',
      description: 'Move the note that is open into the trash',
      run: () => deps.deleteNote(),
    },
    {
      id: `${APP_COMMAND_PREFIX}duplicate-note`,
      title: 'Duplicate note',
      description: 'Copy the note that is open and open the copy',
      shortcut: 'Ctrl+D',
      run: () => deps.duplicateNote?.(),
    },
    {
      id: `${APP_COMMAND_PREFIX}open-trash`,
      title: 'Open trash',
      description: 'Show the deleted notes',
      run: () => deps.openTrash(),
    },
    {
      id: `${APP_COMMAND_PREFIX}expand-all-folders`,
      title: 'Expand all folders',
      description: 'Open every folder of the tree at once',
      run: () => deps.expandAllFolders?.(),
    },
    {
      id: `${APP_COMMAND_PREFIX}collapse-all-folders`,
      title: 'Collapse all folders',
      description: 'Close every folder of the tree at once',
      run: () => deps.collapseAllFolders?.(),
    },
    {
      id: `${APP_COMMAND_PREFIX}switch-vault`,
      title: 'Switch the storage of the notes',
      description: 'Open the recent storages and change the storage',
      run: () => deps.switchVault?.(),
    },
    {
      id: `${APP_COMMAND_PREFIX}settings`,
      title: 'Settings',
      description: 'Theme, view mode, the width of the sidebar and the tree order',
      shortcut: 'Ctrl+,',
      run: () => deps.openSettings(),
    },
    {
      id: `${APP_COMMAND_PREFIX}shortcuts`,
      title: 'Keyboard shortcuts',
      description: 'Show every shortcut of the application',
      shortcut: 'Ctrl+/',
      run: () => deps.openShortcuts(),
    },
    ...RAIL_SECTIONS.map((section) => ({
      id: `${APP_COMMAND_PREFIX}section-${section.id}`,
      title: `Open the ${section.title.toLowerCase()}`,
      description: `Show the section ${section.title} of the left column`,
      run: () => deps.openSection(section.id),
    })),
  ];
}

/**
 * Registers the commands of the application in the registry.
 *
 * @returns an idempotent function that removes the commands again.
 */
export function registerAppCommands(
  registry: CommandRegistry,
  deps: AppCommandDeps,
): () => void {
  const offs = appCommandSpecs(deps).map((spec) => registry.register(APP_COMMAND_OWNER, spec));
  return () => {
    for (const off of offs) off();
  };
}
