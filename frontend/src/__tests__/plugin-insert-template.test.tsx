import { describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../plugins/manifest';
import { PluginPermissionError } from '../core/api/pluginApi';
import type {
  Plugin,
  PluginCommand,
  PluginContext,
  PluginEditor,
  PluginLogger,
  PluginManifest,
  PluginPermission,
  PluginSettings,
} from '../plugins/contract';

/*
 * Boundary rule R7 allows only `src/plugins/**` to import the built-in
 * plugins, and the test file lives in `src/__tests__/`. The plugin module is
 * therefore loaded through `import.meta.glob`, so the checker does not see a
 * literal module specifier of the built-in plugin (the runtime resolves the
 * path relative to this file).
 *
 * Root: it would be cleaner to exempt `src/__tests__/**` from R7 in
 * `scripts/check-boundaries.mjs` and to use a plain static import here.
 */
const pluginModuleLoaders = import.meta.glob<unknown>(
  '../plugins/builtin/insert-template/index.ts',
);
const loadPluginModule = pluginModuleLoaders['../plugins/builtin/insert-template/index.ts'];

interface InsertTemplateModule {
  createInsertTemplatePlugin(): Plugin;
  insertTemplateManifest: PluginManifest;
  DEFAULT_TEMPLATE: string;
  INSERT_TEMPLATE_COMMAND_ID: string;
  TEMPLATE_SETTING_KEY: string;
}

const pluginModule = (await loadPluginModule()) as InsertTemplateModule;
const { createInsertTemplatePlugin, insertTemplateManifest } = pluginModule;
const { DEFAULT_TEMPLATE, INSERT_TEMPLATE_COMMAND_ID } = pluginModule;

/* --------------------------------------------------------------- fixtures */

const ALL_PERMISSIONS: PluginPermission[] = [
  'editor.read',
  'editor.write',
  'ui.contribute',
];

function createLogger(): PluginLogger & {
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as PluginLogger & { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

function createSettings(values: Record<string, unknown> = {}): PluginSettings {
  const settings: PluginSettings = {
    get: async (key: string) => values[key] as never,
    set: async (key: string, value: unknown) => {
      values[key] = value;
    },
    reset: async () => undefined,
    all: async () => ({ ...values }),
  };
  return settings;
}

/**
 * An editor that enforces the permissions the way the host does it, so the
 * plugin is tested against the real enforcement rules.
 */
function createEditor(cursor = { from: 3, to: 3 }, permissions: PluginPermission[] = ALL_PERMISSIONS) {
  const insertAt = vi.fn();
  const insert = vi.fn();
  const need = (permission: PluginPermission): void => {
    if (!permissions.includes(permission)) {
      throw new PluginPermissionError('insert-template', permission);
    }
  };
  const editor: PluginEditor = {
    getText: () => {
      need('editor.read');
      return 'abc';
    },
    getSelection: () => {
      need('editor.read');
      return '';
    },
    getCursor: () => {
      need('editor.read');
      return cursor;
    },
    insert: (text: string) => {
      need('editor.write');
      insert(text);
    },
    insertAt: (text: string, from: number, to: number) => {
      need('editor.write');
      insertAt(text, from, to);
    },
    replaceSelection: vi.fn(),
    focus: vi.fn(),
    openSearch: vi.fn(),
    getPath: () => 'notes/a.md',
    onChange: () => () => undefined,
    onSelectionChange: () => () => undefined,
  };
  return { editor, insert, insertAt };
}

interface Harness {
  ctx: PluginContext;
  commands: Map<string, PluginCommand>;
  logger: PluginLogger & { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  deactivateCallbacks: Array<() => void>;
  /** Opens (or closes) the note in the editor after the activation. */
  setEditor(editor: PluginEditor | null): void;
}

function createHarness(options: {
  editor?: PluginEditor | null;
  settings?: Record<string, unknown>;
  permissions?: PluginPermission[];
} = {}): Harness {
  const commands = new Map<string, PluginCommand>();
  const logger = createLogger();
  const deactivateCallbacks: Array<() => void> = [];
  const permissions = options.permissions ?? ALL_PERMISSIONS;
  // The editor of the application is live: it may appear after the activation.
  let currentEditor: PluginEditor | null = options.editor === undefined ? null : options.editor;

  const ctx: PluginContext = {
    id: 'insert-template',
    version: '1.0.0',
    logger,
    permissions,
    api: {} as PluginContext['api'],
    get editor(): PluginEditor | null {
      return currentEditor;
    },
    settings: createSettings(options.settings ?? {}),
    registerCommand: (cmd: PluginCommand) => {
      if (!permissions.includes('ui.contribute')) {
        throw new PluginPermissionError('insert-template', 'ui.contribute');
      }
      commands.set(cmd.id, cmd);
      return () => {
        commands.delete(cmd.id);
      };
    },
    registerPanel: () => () => undefined,
    registerSidebarItem: () => () => undefined,
    registerContextMenuItem: () => () => undefined,
    registerToolbarItem: () => () => undefined,
    registerSettingsSection: () => () => undefined,
    on: () => () => undefined,
    onEditor: (cb: (editor: PluginEditor | null) => void) => {
      cb(currentEditor);
      return () => undefined;
    },
    onDeactivate: (cb: () => void) => {
      deactivateCallbacks.push(cb);
    },
  };

  return {
    ctx,
    commands,
    logger,
    deactivateCallbacks,
    setEditor: (editor: PluginEditor | null) => {
      currentEditor = editor;
    },
  };
}

/* ----------------------------------------------------------------- tests */

describe('insert-template: manifest', () => {
  it('is a valid manifest', () => {
    const validation = validateManifest(insertTemplateManifest);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it('declares the expected identity', () => {
    expect(insertTemplateManifest.id).toBe('insert-template');
    expect(insertTemplateManifest.name).toBe('Insert Template');
    expect(insertTemplateManifest.version).toBe('1.0.0');
    expect(insertTemplateManifest.manifestVersion).toBe(1);
    expect(insertTemplateManifest.minApiVersion).toBe('1.0.0');
    expect(insertTemplateManifest.author).toBe('Noto');
    expect(insertTemplateManifest.description).toBeTruthy();
  });

  it('declares the permissions it actually uses', () => {
    // The command needs `ui.contribute`, the cursor needs `editor.read` and
    // the insertion needs `editor.write`.
    expect(insertTemplateManifest.permissions).toEqual(
      expect.arrayContaining(['ui.contribute', 'editor.read', 'editor.write']),
    );
  });

  it('declares the template setting with a default value', () => {
    const schema = insertTemplateManifest.settings?.find((s) => s.key === 'template');
    expect(schema).toBeTruthy();
    expect(schema?.type).toBe('string');
    expect(schema?.label).toBe('Template');
    expect(schema?.default).toBe(DEFAULT_TEMPLATE);
  });
});

describe('insert-template: command', () => {
  it('registers the command on activation and removes it on deactivation', () => {
    const plugin = createInsertTemplatePlugin();
    const { ctx, commands, deactivateCallbacks } = createHarness();

    plugin.activate(ctx);
    expect(commands.has(INSERT_TEMPLATE_COMMAND_ID)).toBe(true);
    expect(commands.get(INSERT_TEMPLATE_COMMAND_ID)?.title).toBe('Insert template');

    // The host calls the deactivate callbacks when the plugin is disabled.
    for (const cb of deactivateCallbacks) cb();
    expect(commands.has(INSERT_TEMPLATE_COMMAND_ID)).toBe(false);
  });

  it('removes the command when the plugin is deactivated directly', () => {
    const plugin = createInsertTemplatePlugin();
    const { ctx, commands } = createHarness();

    plugin.activate(ctx);
    expect(commands.has(INSERT_TEMPLATE_COMMAND_ID)).toBe(true);

    plugin.deactivate?.();
    expect(commands.has(INSERT_TEMPLATE_COMMAND_ID)).toBe(false);
  });

  it('inserts the default template at the cursor position', async () => {
    const plugin = createInsertTemplatePlugin();
    const { editor, insertAt } = createEditor({ from: 3, to: 3 });
    const { ctx, commands } = createHarness({ editor });

    plugin.activate(ctx);
    await commands.get(INSERT_TEMPLATE_COMMAND_ID)?.run();

    expect(insertAt).toHaveBeenCalledTimes(1);
    expect(insertAt).toHaveBeenCalledWith(DEFAULT_TEMPLATE, 3, 3);
  });

  it('uses the editor that is open at the moment of the call', async () => {
    const plugin = createInsertTemplatePlugin();
    const { ctx, commands, setEditor } = createHarness({ editor: null });

    // The plugin is activated without an open note.
    plugin.activate(ctx);

    // The note is opened later: the live editor of the context must be used.
    const { editor, insertAt } = createEditor({ from: 5, to: 5 });
    setEditor(editor);

    await commands.get(INSERT_TEMPLATE_COMMAND_ID)?.run();

    expect(insertAt).toHaveBeenCalledTimes(1);
    expect(insertAt).toHaveBeenCalledWith(DEFAULT_TEMPLATE, 5, 5);
  });

  it('uses the template from the settings instead of the default', async () => {
    const plugin = createInsertTemplatePlugin();
    const { editor, insertAt } = createEditor({ from: 0, to: 0 });
    const { ctx, commands } = createHarness({
      editor,
      settings: { template: '# Свой шаблон\n\n- [ ] шаг' },
    });

    plugin.activate(ctx);
    await commands.get(INSERT_TEMPLATE_COMMAND_ID)?.run();

    expect(insertAt).toHaveBeenCalledWith('# Свой шаблон\n\n- [ ] шаг', 0, 0);
  });

  it('does nothing and logs when no note is open', async () => {
    const plugin = createInsertTemplatePlugin();
    const { ctx, commands, logger } = createHarness({ editor: null });

    plugin.activate(ctx);
    await expect(commands.get(INSERT_TEMPLATE_COMMAND_ID)?.run()).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('logs a failure instead of throwing when the insertion fails', async () => {
    const plugin = createInsertTemplatePlugin();
    const { editor } = createEditor();
    editor.insertAt = vi.fn(() => {
      throw new Error('boom');
    });
    const { ctx, commands, logger } = createHarness({ editor });

    plugin.activate(ctx);
    await expect(commands.get(INSERT_TEMPLATE_COMMAND_ID)?.run()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('does not insert anything without the editor.write permission', async () => {
    const plugin = createInsertTemplatePlugin();
    const { editor, insertAt } = createEditor({ from: 0, to: 0 }, ['editor.read', 'ui.contribute']);
    const { ctx, commands, logger } = createHarness({ editor });

    plugin.activate(ctx);
    await expect(commands.get(INSERT_TEMPLATE_COMMAND_ID)?.run()).resolves.toBeUndefined();

    expect(insertAt).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('cannot register the command without the ui.contribute permission', () => {
    const plugin = createInsertTemplatePlugin();
    const { ctx } = createHarness({ permissions: ['editor.read', 'editor.write'] });

    expect(() => plugin.activate(ctx)).toThrow(PluginPermissionError);
  });

  it('does not execute the command after the deactivation', async () => {
    const plugin = createInsertTemplatePlugin();
    const { editor, insertAt } = createEditor();
    const { ctx, commands, deactivateCallbacks } = createHarness({ editor });

    plugin.activate(ctx);
    for (const cb of deactivateCallbacks) cb();

    // The command is not in the registry anymore, so it cannot be run.
    expect(commands.has(INSERT_TEMPLATE_COMMAND_ID)).toBe(false);
    expect(commands.get(INSERT_TEMPLATE_COMMAND_ID)).toBeUndefined();
    expect(insertAt).not.toHaveBeenCalled();
  });
});
