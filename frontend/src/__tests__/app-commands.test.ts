// Coverage of the commands of the application that phase 14 added: the two
// commands of the tree (expand and collapse every folder) and the command that
// opens the menu of the storage.
//
// The commands are pure data plus a `run` callback, so the tests drive them
// directly through a `deps` object built from spies.
import { describe, expect, it, vi } from 'vitest';
import {
  APP_COMMAND_OWNER,
  APP_COMMAND_PREFIX,
  appCommandSpecs,
  registerAppCommands,
  type AppCommandDeps,
} from '../core/commands/appCommands';
import { CommandRegistry } from '../core/commands/commandRegistry';
import { SHORTCUTS, shortcutById } from '../core/commands/shortcuts';

/** The ids of the three commands of phase 14. */
const PHASE14_IDS = [
  'app:expand-all-folders',
  'app:collapse-all-folders',
  'app:switch-vault',
] as const;

/** A `deps` object whose optional callbacks are wired to spies. */
function makeDeps(): AppCommandDeps & {
  expandAllFolders: ReturnType<typeof vi.fn>;
  collapseAllFolders: ReturnType<typeof vi.fn>;
  switchVault: ReturnType<typeof vi.fn>;
} {
  return {
    createNote: vi.fn(),
    createFolder: vi.fn(),
    dailyNote: vi.fn(),
    openSearch: vi.fn(),
    toggleTheme: vi.fn(),
    openTrash: vi.fn(),
    renameNote: vi.fn(),
    deleteNote: vi.fn(),
    openSettings: vi.fn(),
    openShortcuts: vi.fn(),
    openSection: vi.fn(),
    expandAllFolders: vi.fn(),
    collapseAllFolders: vi.fn(),
    switchVault: vi.fn(),
  };
}

/** The command of the given id, or a failure when it is missing. */
function commandOf(deps: AppCommandDeps, id: string) {
  const spec = appCommandSpecs(deps).find((entry) => entry.id === id);
  if (!spec) throw new Error(`the command ${id} does not exist`);
  return spec;
}

describe('the commands of the application', () => {
  it('declares the commands of phase 14 with their exact ids and titles', () => {
    const specs = appCommandSpecs(makeDeps());
    const ids = specs.map((spec) => spec.id);

    expect(ids).toContain('app:expand-all-folders');
    expect(ids).toContain('app:collapse-all-folders');
    expect(ids).toContain('app:switch-vault');

    expect(commandOf(makeDeps(), 'app:expand-all-folders').title).toBe('Expand all folders');
    expect(commandOf(makeDeps(), 'app:collapse-all-folders').title).toBe('Collapse all folders');
    expect(commandOf(makeDeps(), 'app:switch-vault').title).toBe('Switch the storage of the notes');
  });

  it('gives every command of phase 14 a non-empty description', () => {
    const deps = makeDeps();
    for (const id of PHASE14_IDS) {
      const description = commandOf(deps, id).description;
      expect(description).toBeTruthy();
      expect(description?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it('gives every command of the application a unique id under the prefix of the application', () => {
    const ids = appCommandSpecs(makeDeps()).map((spec) => spec.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith(APP_COMMAND_PREFIX)).toBe(true);
  });

  it('opens every folder of the tree when the expand command runs', () => {
    const deps = makeDeps();
    commandOf(deps, 'app:expand-all-folders').run();

    expect(deps.expandAllFolders).toHaveBeenCalledTimes(1);
    expect(deps.collapseAllFolders).not.toHaveBeenCalled();
    expect(deps.switchVault).not.toHaveBeenCalled();
  });

  it('closes every folder of the tree when the collapse command runs', () => {
    const deps = makeDeps();
    commandOf(deps, 'app:collapse-all-folders').run();

    expect(deps.collapseAllFolders).toHaveBeenCalledTimes(1);
    expect(deps.expandAllFolders).not.toHaveBeenCalled();
    expect(deps.switchVault).not.toHaveBeenCalled();
  });

  it('opens the menu of the storage when the switch command runs', () => {
    const deps = makeDeps();
    commandOf(deps, 'app:switch-vault').run();

    expect(deps.switchVault).toHaveBeenCalledTimes(1);
    expect(deps.expandAllFolders).not.toHaveBeenCalled();
    expect(deps.collapseAllFolders).not.toHaveBeenCalled();
  });

  it('does not throw when the optional callbacks of phase 14 are missing', () => {
    // The shell wires the callbacks when the store is ready, so a command may
    // run before they exist.
    const deps = makeDeps();
    const bare: AppCommandDeps = { ...deps };
    delete bare.expandAllFolders;
    delete bare.collapseAllFolders;
    delete bare.switchVault;

    expect(() => commandOf(bare, 'app:expand-all-folders').run()).not.toThrow();
    expect(() => commandOf(bare, 'app:collapse-all-folders').run()).not.toThrow();
    expect(() => commandOf(bare, 'app:switch-vault').run()).not.toThrow();
  });

  it('registers the commands of phase 14 in the registry', () => {
    const registry = new CommandRegistry();
    registerAppCommands(registry, makeDeps());

    for (const id of PHASE14_IDS) {
      expect(registry.has(id)).toBe(true);
    }
    expect(registry.count(APP_COMMAND_OWNER)).toBe(appCommandSpecs(makeDeps()).length);
  });

  it('runs a registered command of phase 14 through the registry', () => {
    const registry = new CommandRegistry();
    const deps = makeDeps();
    registerAppCommands(registry, deps);

    registry.run('app:expand-all-folders');
    registry.run('app:collapse-all-folders');
    registry.run('app:switch-vault');

    expect(deps.expandAllFolders).toHaveBeenCalledTimes(1);
    expect(deps.collapseAllFolders).toHaveBeenCalledTimes(1);
    expect(deps.switchVault).toHaveBeenCalledTimes(1);
  });

  it('removes the commands of phase 14 when the registration is undone', () => {
    const registry = new CommandRegistry();
    const unregister = registerAppCommands(registry, makeDeps());

    unregister();

    for (const id of PHASE14_IDS) {
      expect(registry.has(id)).toBe(false);
    }
    expect(registry.count(APP_COMMAND_OWNER)).toBe(0);
  });

  it('gives no keyboard shortcut to the commands of phase 14', () => {
    const deps = makeDeps();
    for (const id of PHASE14_IDS) {
      expect(commandOf(deps, id).shortcut).toBeUndefined();
    }
  });

  it('registers no shortcut of phase 14 in the keyboard map', () => {
    // The keyboard map is the single source of truth of the shortcuts: a
    // command that is not in it has no key combination.
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    for (const id of PHASE14_IDS) {
      expect(ids).not.toContain(id);
    }
    expect(shortcutById('app:expand-all-folders')).toBeUndefined();
    expect(shortcutById('app:collapse-all-folders')).toBeUndefined();
    expect(shortcutById('app:switch-vault')).toBeUndefined();
  });
});
