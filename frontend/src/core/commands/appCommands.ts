// The commands of the application itself.
//
// The plugins contribute their commands to the same `CommandRegistry`, so the
// command palette shows both kinds at once. The commands of the application
// are registered under the owner `app` and their ids are prefixed with
// `app:` — a plugin may not use that prefix (the registry refuses duplicate
// ids anyway).
import type { CommandLike, CommandRegistry } from './commandRegistry';

/** The owner of the commands of the application. */
export const APP_COMMAND_OWNER = 'app';

/** The prefix of every command of the application. */
export const APP_COMMAND_PREFIX = 'app:';

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
  /** Opens the settings of the application. */
  openSettings(): void;
  /** Opens the help of the keyboard shortcuts. */
  openShortcuts(): void;
  /** Collapses or expands the sidebar of the notes. */
  toggleSidebar(): void;
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
      id: `${APP_COMMAND_PREFIX}open-trash`,
      title: 'Open trash',
      description: 'Show the deleted notes',
      run: () => deps.openTrash(),
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
    {
      id: `${APP_COMMAND_PREFIX}toggle-sidebar`,
      title: 'Toggle sidebar',
      description: 'Collapse or expand the panel of the notes',
      shortcut: 'Ctrl+Alt+B',
      run: () => deps.toggleSidebar(),
    },
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
