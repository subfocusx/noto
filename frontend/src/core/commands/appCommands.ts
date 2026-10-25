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
export const RAIL_SECTIONS: {
  id: RailSection;
  title: string;
  titleKey: string;
  icon: string;
  group: RailGroup;
}[] = [
  { id: 'explorer', title: 'Explorer', titleKey: 'rail.explorer', icon: 'folder', group: 'notes' },
  { id: 'favorites', title: 'Favorites', titleKey: 'rail.favorites', icon: 'star', group: 'notes' },
  { id: 'calendar', title: 'Calendar', titleKey: 'rail.calendar', icon: 'calendar', group: 'notes' },
  { id: 'search', title: 'Search', titleKey: 'rail.search', icon: 'search', group: 'notes' },
  { id: 'filters', title: 'Filters', titleKey: 'rail.filters', icon: 'filter', group: 'notes' },
  { id: 'history', title: 'History', titleKey: 'rail.history', icon: 'clock', group: 'storage' },
  {
    id: 'notifications',
    title: 'Notifications',
    titleKey: 'rail.notifications',
    icon: 'bell',
    group: 'storage',
  },
  { id: 'trash', title: 'Trash', titleKey: 'rail.trash', icon: 'trash', group: 'storage' },
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
      titleKey: 'command.newNote.title',
      description: 'Create a new Markdown note',
      descriptionKey: 'command.newNote.description',
      run: () => deps.createNote(),
    },
    {
      id: `${APP_COMMAND_PREFIX}new-folder`,
      title: 'New folder',
      titleKey: 'command.newFolder.title',
      description: 'Create a new folder in the library',
      descriptionKey: 'command.newFolder.description',
      run: () => deps.createFolder(),
    },
    {
      id: `${APP_COMMAND_PREFIX}daily-note`,
      title: 'Daily note',
      titleKey: 'command.dailyNote.title',
      description: 'Open (or create) the note of today, YYYY-MM-DD.md',
      descriptionKey: 'command.dailyNote.description',
      run: () => deps.dailyNote(),
    },
    {
      id: `${APP_COMMAND_PREFIX}search`,
      title: 'Search notes',
      titleKey: 'command.search.title',
      description: 'Search across all the notes',
      descriptionKey: 'command.search.description',
      shortcut: 'Ctrl+Shift+F',
      run: () => deps.openSearch(),
    },
    {
      id: `${APP_COMMAND_PREFIX}toggle-theme`,
      title: 'Toggle theme',
      titleKey: 'command.toggleTheme.title',
      description: 'Switch between the light and the dark theme',
      descriptionKey: 'command.toggleTheme.description',
      run: () => deps.toggleTheme(),
    },
    {
      id: `${APP_COMMAND_PREFIX}rename-note`,
      title: 'Rename note',
      titleKey: 'command.renameNote.title',
      description: 'Rename the note that is open',
      descriptionKey: 'command.renameNote.description',
      run: () => deps.renameNote(),
    },
    {
      id: `${APP_COMMAND_PREFIX}delete-note`,
      title: 'Delete note',
      titleKey: 'command.deleteNote.title',
      description: 'Move the note that is open into the trash',
      descriptionKey: 'command.deleteNote.description',
      run: () => deps.deleteNote(),
    },
    {
      id: `${APP_COMMAND_PREFIX}duplicate-note`,
      title: 'Duplicate note',
      titleKey: 'command.duplicateNote.title',
      description: 'Copy the note that is open and open the copy',
      descriptionKey: 'command.duplicateNote.description',
      shortcut: 'Ctrl+D',
      run: () => deps.duplicateNote?.(),
    },
    {
      id: `${APP_COMMAND_PREFIX}open-trash`,
      title: 'Open trash',
      titleKey: 'command.openTrash.title',
      description: 'Show the deleted notes',
      descriptionKey: 'command.openTrash.description',
      run: () => deps.openTrash(),
    },
    {
      id: `${APP_COMMAND_PREFIX}expand-all-folders`,
      title: 'Expand all folders',
      titleKey: 'command.expandAll.title',
      description: 'Open every folder of the tree at once',
      descriptionKey: 'command.expandAll.description',
      run: () => deps.expandAllFolders?.(),
    },
    {
      id: `${APP_COMMAND_PREFIX}collapse-all-folders`,
      title: 'Collapse all folders',
      titleKey: 'command.collapseAll.title',
      description: 'Close every folder of the tree at once',
      descriptionKey: 'command.collapseAll.description',
      run: () => deps.collapseAllFolders?.(),
    },
    {
      id: `${APP_COMMAND_PREFIX}switch-vault`,
      title: 'Switch the storage of the notes',
      titleKey: 'command.switchVault.title',
      description: 'Open the recent storages and change the storage',
      descriptionKey: 'command.switchVault.description',
      run: () => deps.switchVault?.(),
    },
    {
      id: `${APP_COMMAND_PREFIX}settings`,
      title: 'Settings',
      titleKey: 'command.settings.title',
      description: 'Theme, view mode, the width of the sidebar and the tree order',
      descriptionKey: 'command.settings.description',
      shortcut: 'Ctrl+,',
      run: () => deps.openSettings(),
    },
    {
      id: `${APP_COMMAND_PREFIX}shortcuts`,
      title: 'Keyboard shortcuts',
      titleKey: 'command.shortcuts.title',
      description: 'Show every shortcut of the application',
      descriptionKey: 'command.shortcuts.description',
      shortcut: 'Ctrl+/',
      run: () => deps.openShortcuts(),
    },
    ...RAIL_SECTIONS.map((section) => ({
      id: `${APP_COMMAND_PREFIX}section-${section.id}`,
      title: `Open the ${section.title.toLowerCase()}`,
      titleKey: 'command.section.title',
      titleParams: { section: `$${section.titleKey}` },
      description: `Show the section ${section.title} of the left column`,
      descriptionKey: 'command.section.description',
      descriptionParams: { section: `$${section.titleKey}` },
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
