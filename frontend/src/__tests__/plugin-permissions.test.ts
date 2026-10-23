// Tests of the permission enforcement of the plugin platform.
//
// The permissions declared in the manifest of a plugin are enforced by the
// host: every capability handed to the plugin is a restricted wrapper that
// checks the permissions before the call. A forbidden operation throws a
// `PluginPermissionError` into the code of the plugin — it is never a
// silent no-op.
//
// The file also covers the related fixes of the platform:
//   * the live `ctx.editor` and `ctx.onEditor`;
//   * the type check of the settings store;
//   * the `validated` state of the plugin lifecycle.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  PLUGIN_API_VERSION,
  PluginPermissionError,
  type Plugin,
  type PluginApi,
  type PluginContext,
  type PluginEditor,
  type PluginEventMap,
  type PluginManifest,
  type PluginPermission,
} from '../plugins/contract';
import { PluginRegistry } from '../plugins/registry';
import { PluginHost } from '../plugins/host';
import { EventBus } from '../core/events/eventBus';
import { CommandRegistry } from '../core/commands/commandRegistry';
import { SettingsStore } from '../core/settings/settingsStore';
import { createPluginApi, restrictPluginApi } from '../core/api/pluginApi';

/* ------------------------------------------------------------------ fixtures */

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'perm.demo',
    name: 'Permission demo',
    version: '1.0.0',
    manifestVersion: 1,
    minApiVersion: PLUGIN_API_VERSION,
    permissions: [],
    ...overrides,
  };
}

/** A data API that never touches the network. */
function mockApi(): PluginApi {
  return {
    getNote: async (path) => ({
      path,
      content: 'the content of the note',
      revision: 1,
      updatedAt: 'now',
      conflict: false,
    }),
    getTree: async () => ({ folders: [], files: [] }),
    search: async () => [],
    saveNote: async (path, content, revision) => ({
      path,
      content,
      revision,
      updatedAt: 'now',
    }),
  };
}

/** A fake editor that records the calls of the plugin. */
function makeEditor() {
  const calls: string[] = [];
  const editor: PluginEditor = {
    getText: () => {
      calls.push('getText');
      return 'hello';
    },
    getSelection: () => {
      calls.push('getSelection');
      return '';
    },
    getCursor: () => {
      calls.push('getCursor');
      return { from: 0, to: 0 };
    },
    insert: () => {
      calls.push('insert');
    },
    insertAt: () => {
      calls.push('insertAt');
    },
    replaceSelection: () => {
      calls.push('replaceSelection');
    },
    focus: () => {
      calls.push('focus');
    },
    openSearch: () => {
      calls.push('openSearch');
    },
    getPath: () => 'notes/a.md',
    onChange: () => {
      calls.push('onChange');
      return () => undefined;
    },
    onSelectionChange: () => {
      calls.push('onSelectionChange');
      return () => undefined;
    },
  };
  return { editor, calls };
}

/** The harness of a plugin: the host, the registry and the raw objects. */
function makeHost(options: {
  permissions?: PluginPermission[];
  editor?: PluginEditor | null;
  getEditor?: () => PluginEditor | null;
  api?: PluginApi;
  subscribeEditor?: (cb: (editor: PluginEditor | null) => void) => () => void;
} = {}) {
  const registry = new PluginRegistry();
  const bus = new EventBus<PluginEventMap>();
  const commands = new CommandRegistry();
  const settings = new SettingsStore();
  const rawApi = options.api ?? mockApi();
  const rawEditor = options.editor ?? null;
  const getEditor = options.getEditor ?? (() => rawEditor);
  const host = new PluginHost({
    registry,
    bus,
    commands,
    settings,
    createApi: () => rawApi,
    getEditor,
    ...(options.subscribeEditor ? { subscribeEditor: options.subscribeEditor } : {}),
  });
  return { registry, bus, commands, settings, host, rawApi, rawEditor, getEditor };
}

/** Activates a plugin with the given permissions and returns its context. */
async function activate(
  host: PluginHost,
  registry: PluginRegistry,
  permissions: PluginPermission[],
  activate: (ctx: PluginContext) => void | Promise<void>,
): Promise<PluginContext | null> {
  let ctx: PluginContext | null = null;
  const plugin: Plugin = {
    manifest: manifest({ permissions }),
    activate: (c) => {
      ctx = c;
      return activate(c);
    },
  };
  registry.register(plugin);
  registry.enable('perm.demo');
  await host.activate('perm.demo');
  return ctx;
}

/* ------------------------------------------------------------ api permissions */

describe('permissions: the data API', () => {
  it('refuses to save a note without "notes.write"', async () => {
    const { host, registry } = makeHost();
    const ctx = await activate(host, registry, ['notes.read'], () => {});

    await expect(ctx!.api.saveNote('a.md', 'the secret text', 1)).rejects.toThrow(
      PluginPermissionError,
    );
  });

  it('names the plugin and the missing permission in the error', async () => {
    const { host, registry } = makeHost();
    const ctx = await activate(host, registry, [], () => {});

    const error = await ctx!.api.saveNote('a.md', 'the secret text', 1).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PluginPermissionError);
    const permissionError = error as PluginPermissionError;
    expect(permissionError.pluginId).toBe('perm.demo');
    expect(permissionError.permission).toBe('notes.write');
    expect(permissionError.message).toBe('plugin "perm.demo" requires permission "notes.write"');
    // The content of the note must never leak into the error.
    expect(permissionError.message).not.toContain('the secret text');
  });

  it('saves the note when the plugin declared "notes.write"', async () => {
    const saveNote = vi.fn(async (path: string, content: string, revision: number) => ({
      path,
      content,
      revision,
      updatedAt: 'now',
    }));
    const api = mockApi();
    api.saveNote = saveNote;
    const { host, registry } = makeHost({ api });
    const ctx = await activate(host, registry, ['notes.write'], () => {});

    const response = await ctx!.api.saveNote('a.md', 'text', 3);
    expect(response.path).toBe('a.md');
    expect(response.revision).toBe(3);
    expect(saveNote).toHaveBeenCalledWith('a.md', 'text', 3);
  });

  it('refuses to read a note without "notes.read"', async () => {
    const { host, registry } = makeHost();
    const ctx = await activate(host, registry, ['notes.write'], () => {});

    await expect(ctx!.api.getNote('a.md')).rejects.toThrow(PluginPermissionError);
  });

  it('reads the note when the plugin declared "notes.read"', async () => {
    const { host, registry } = makeHost();
    const ctx = await activate(host, registry, ['notes.read'], () => {});

    const note = await ctx!.api.getNote('a.md');
    expect(note.path).toBe('a.md');
  });

  it('refuses to read the tree without "tree.read"', async () => {
    const { host, registry } = makeHost();
    const ctx = await activate(host, registry, ['notes.read'], () => {});

    const error = await ctx!.api.getTree().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PluginPermissionError);
    expect((error as PluginPermissionError).permission).toBe('tree.read');
  });

  it('reads the tree when the plugin declared "tree.read"', async () => {
    const { host, registry } = makeHost();
    const ctx = await activate(host, registry, ['tree.read'], () => {});

    await expect(ctx!.api.getTree()).resolves.toEqual({ folders: [], files: [] });
  });

  it('refuses to search without "search.read"', async () => {
    const { host, registry } = makeHost();
    const ctx = await activate(host, registry, ['notes.read'], () => {});

    const error = await ctx!.api.search('hello').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PluginPermissionError);
    expect((error as PluginPermissionError).permission).toBe('search.read');
  });

  it('searches when the plugin declared "search.read"', async () => {
    const { host, registry } = makeHost();
    const ctx = await activate(host, registry, ['search.read'], () => {});

    await expect(ctx!.api.search('hello')).resolves.toEqual([]);
  });
});

/* --------------------------------------------------------- editor permissions */

describe('permissions: the editor', () => {
  it('refuses to read the editor without "editor.read"', async () => {
    const { editor } = makeEditor();
    const { host, registry } = makeHost({ editor });
    const ctx = await activate(host, registry, ['editor.write'], () => {});

    let error: unknown = null;
    try {
      ctx!.editor!.getText();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(PluginPermissionError);
    expect((error as PluginPermissionError).permission).toBe('editor.read');
  });

  it('refuses to read the selection and the cursor without "editor.read"', async () => {
    const { editor } = makeEditor();
    const { host, registry } = makeHost({ editor });
    const ctx = await activate(host, registry, [], () => {});

    expect(() => ctx!.editor!.getSelection()).toThrow(PluginPermissionError);
    expect(() => ctx!.editor!.getCursor()).toThrow(PluginPermissionError);
  });

  it('reads the editor when the plugin declared "editor.read"', async () => {
    const { editor } = makeEditor();
    const { host, registry } = makeHost({ editor });
    const ctx = await activate(host, registry, ['editor.read'], () => {});

    expect(ctx!.editor!.getText()).toBe('hello');
    expect(ctx!.editor!.getCursor()).toEqual({ from: 0, to: 0 });
  });

  it('refuses to write into the editor without "editor.write"', async () => {
    const { editor, calls } = makeEditor();
    const { host, registry } = makeHost({ editor });
    const ctx = await activate(host, registry, ['editor.read'], () => {});

    expect(() => ctx!.editor!.insert('x')).toThrow(PluginPermissionError);
    expect(() => ctx!.editor!.insertAt('x', 0, 0)).toThrow(PluginPermissionError);
    expect(() => ctx!.editor!.replaceSelection('x')).toThrow(PluginPermissionError);
    // Nothing reached the editor of the application.
    expect(calls).toEqual([]);
  });

  it('writes into the editor when the plugin declared "editor.write"', async () => {
    const { editor, calls } = makeEditor();
    const { host, registry } = makeHost({ editor });
    const ctx = await activate(host, registry, ['editor.write'], () => {});

    ctx!.editor!.insert('x');
    ctx!.editor!.insertAt('y', 0, 0);
    ctx!.editor!.replaceSelection('z');
    expect(calls).toEqual(['insert', 'insertAt', 'replaceSelection']);
  });

  it('refuses to subscribe to the changes without "editor.read"', async () => {
    const { editor } = makeEditor();
    const { host, registry } = makeHost({ editor });
    const ctx = await activate(host, registry, ['editor.write'], () => {});

    expect(() => ctx!.editor!.onChange(() => undefined)).toThrow(PluginPermissionError);
    expect(() => ctx!.editor!.onSelectionChange(() => undefined)).toThrow(PluginPermissionError);
  });
});

/* ---------------------------------------------------------- ui contributions */

describe('permissions: the UI contributions', () => {
  it('refuses every UI contribution without "ui.contribute"', async () => {
    const { host, registry } = makeHost();
    const ctx = await activate(host, registry, ['notes.read'], () => {});

    expect(() => ctx!.registerCommand({ id: 'c', title: 'C', run: () => undefined })).toThrow(
      PluginPermissionError,
    );
    expect(() => ctx!.registerPanel({ id: 'p', title: 'P', render: () => null })).toThrow(
      PluginPermissionError,
    );
    expect(() => ctx!.registerSidebarItem({ id: 's', title: 'S', onSelect: () => undefined })).toThrow(
      PluginPermissionError,
    );
    expect(() =>
      ctx!.registerContextMenuItem({
        id: 'm',
        title: 'M',
        appliesTo: () => true,
        run: () => undefined,
      }),
    ).toThrow(PluginPermissionError);
    expect(() => ctx!.registerToolbarItem({ id: 't', title: 'T', run: () => undefined })).toThrow(
      PluginPermissionError,
    );
    expect(() => ctx!.registerSettingsSection({ id: 'ss', title: 'SS', render: () => null })).toThrow(
      PluginPermissionError,
    );
  });

  it('registers the contributions when the plugin declared "ui.contribute"', async () => {
    const { host, registry, commands } = makeHost();
    const ctx = await activate(host, registry, ['ui.contribute'], (c) => {
      c.registerCommand({ id: 'demo.cmd', title: 'C', run: () => undefined });
      c.registerPanel({ id: 'demo.panel', title: 'P', render: () => null });
      c.registerSidebarItem({ id: 'demo.side', title: 'S', onSelect: () => undefined });
      c.registerContextMenuItem({
        id: 'demo.menu',
        title: 'M',
        appliesTo: () => true,
        run: () => undefined,
      });
      c.registerToolbarItem({ id: 'demo.tool', title: 'T', run: () => undefined });
      c.registerSettingsSection({ id: 'demo.settings', title: 'SS', render: () => null });
    });

    expect(ctx).not.toBeNull();
    expect(commands.has('demo.cmd')).toBe(true);
    expect(host.panels()).toHaveLength(1);
    expect(host.sidebarItems()).toHaveLength(1);
    expect(host.contextMenuItems()).toHaveLength(1);
    expect(host.toolbarItems()).toHaveLength(1);
    expect(host.settingsSections()).toHaveLength(1);
  });

  it('does not break the activation when the plugin does not catch the refusal', async () => {
    const { host, registry, commands } = makeHost();
    registry.register({
      manifest: manifest({ permissions: [] }),
      activate: (ctx) => {
        ctx.registerCommand({ id: 'demo.cmd', title: 'C', run: () => undefined });
      },
    });
    registry.enable('perm.demo');

    await expect(host.activate('perm.demo')).resolves.toBeUndefined();
    // The plugin stays active, but the forbidden contribution is missing.
    expect(registry.get('perm.demo')?.state).toBe('active');
    expect(registry.get('perm.demo')?.error).toContain('ui.contribute');
    expect(commands.has('demo.cmd')).toBe(false);
  });

  it('lets the plugin catch the refusal and continue', async () => {
    const { host, registry, commands } = makeHost();
    let caught: unknown = null;
    registry.register({
      manifest: manifest({ permissions: [] }),
      activate: (ctx) => {
        try {
          ctx.registerCommand({ id: 'demo.cmd', title: 'C', run: () => undefined });
        } catch (err) {
          caught = err;
        }
      },
    });
    registry.enable('perm.demo');
    await host.activate('perm.demo');

    expect(caught).toBeInstanceOf(PluginPermissionError);
    expect(registry.get('perm.demo')?.state).toBe('active');
    expect(commands.has('demo.cmd')).toBe(false);
  });
});

/* --------------------------------------------------------------- the settings */

describe('permissions: the settings', () => {
  it('refuses to write the settings without "settings.write"', async () => {
    const { host, registry } = makeHost();
    const ctx = await activate(host, registry, ['notes.read'], () => {});

    const error = await ctx!.settings.set('key', 'value').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PluginPermissionError);
    expect((error as PluginPermissionError).permission).toBe('settings.write');
    await expect(ctx!.settings.reset('key')).rejects.toThrow(PluginPermissionError);
  });

  it('writes the settings when the plugin declared "settings.write"', async () => {
    const { host, registry, settings } = makeHost();
    const ctx = await activate(host, registry, ['settings.write'], () => {});

    await ctx!.settings.set('key', 'value');
    expect(await settings.get('perm.demo', 'key', 'fallback')).toBe('value');
    await ctx!.settings.reset('key');
    expect(await settings.get('perm.demo', 'key', 'fallback')).toBe('fallback');
  });

  it('reads the own settings of the plugin without any permission', async () => {
    const { host, registry, settings } = makeHost();
    await settings.set('perm.demo', 'key', 'value');
    const ctx = await activate(host, registry, [], () => {});

    expect(await ctx!.settings.get('key')).toBe('value');
    expect(await ctx!.settings.all()).toEqual({ key: 'value' });
  });
});

/* ------------------------------------------------------- no unrestricted access */

describe('permissions: the plugin gets only restricted wrappers', () => {
  it('never hands the unrestricted API to the plugin', async () => {
    const { host, registry, rawApi } = makeHost();
    const ctx = await activate(host, registry, ['notes.read'], () => {});

    expect(ctx!.api).not.toBe(rawApi);
    expect(ctx!.api.saveNote).not.toBe(rawApi.saveNote);
    expect(ctx!.api.getNote).not.toBe(rawApi.getNote);
    expect(Object.keys(ctx!.api).sort()).toEqual(['getNote', 'getTree', 'saveNote', 'search']);
    // There is no reference to the original object in the context.
    expect(Object.values(ctx!).some((value) => value === rawApi)).toBe(false);
  });

  it('never hands the unrestricted editor to the plugin', async () => {
    const { editor } = makeEditor();
    const { host, registry, rawEditor } = makeHost({ editor });
    const ctx = await activate(host, registry, ['editor.read'], () => {});

    expect(ctx!.editor).not.toBe(rawEditor);
    expect(ctx!.editor!.getText).not.toBe(editor.getText);
    expect(Object.values(ctx!).some((value) => value === rawEditor)).toBe(false);
  });

  it('reports the permissions of the plugin and does not let it change them', async () => {
    const { host, registry } = makeHost();
    const ctx = await activate(host, registry, ['notes.read'], () => {});

    expect(ctx!.permissions).toEqual(['notes.read']);
    expect(Object.isFrozen(ctx!.permissions)).toBe(true);
  });

  it('restricts an API instance directly', async () => {
    const saveNote = vi.fn(async (path: string, content: string, revision: number) => ({
      path,
      content,
      revision,
      updatedAt: 'now',
    }));
    const api = mockApi();
    api.saveNote = saveNote;
    const restricted = restrictPluginApi(api, 'perm.demo', ['notes.read']);

    await expect(restricted.saveNote('a.md', 'text', 1)).rejects.toThrow(PluginPermissionError);
    expect(saveNote).not.toHaveBeenCalled();
  });

  it('runs the data API unrestricted when no permissions are given', async () => {
    const api = createPluginApi({
      saveNote: async (path, content, revision) => ({ path, content, revision, updatedAt: 'now' }),
    });
    await expect(api.saveNote('a.md', 'text', 1)).resolves.toMatchObject({ path: 'a.md' });
  });

  it('runs the data API restricted when the permissions are given', async () => {
    const api = createPluginApi(
      {
        saveNote: async (path, content, revision) => ({ path, content, revision, updatedAt: 'now' }),
      },
      { pluginId: 'perm.demo', permissions: ['notes.write'] },
    );
    await expect(api.saveNote('a.md', 'text', 1)).resolves.toMatchObject({ path: 'a.md' });
    await expect(api.getNote('a.md')).rejects.toThrow(PluginPermissionError);
  });
});

/* ------------------------------------------------------------- the live editor */

describe('the editor of the context is live', () => {
  it('gives the editor to a plugin that was activated without an open note', async () => {
    const { editor } = makeEditor();
    let open: PluginEditor | null = null;
    const { host, registry } = makeHost({ getEditor: () => open });
    const ctx = await activate(host, registry, ['editor.read'], () => {});

    // No note is open yet.
    expect(ctx!.editor).toBeNull();

    // The note is opened: the editor is available right away.
    open = editor;
    expect(ctx!.editor).not.toBeNull();
    expect(ctx!.editor!.getText()).toBe('hello');
  });

  it('notifies the plugin when the editor appears', async () => {
    const { editor } = makeEditor();
    let open: PluginEditor | null = null;
    const { host, registry } = makeHost({ getEditor: () => open });
    const seen: Array<PluginEditor | null> = [];
    const ctx = await activate(host, registry, ['editor.read'], (c) => {
      c.onEditor?.((next) => {
        seen.push(next);
      });
    });

    // The callback is called immediately with the current editor.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeNull();

    // The note is opened: reading the editor polls the host.
    open = editor;
    expect(ctx!.editor).not.toBeNull();

    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBeNull();
    expect(seen[1]!.getText()).toBe('hello');
  });

  it('notifies the plugin through the push subscription', async () => {
    let open: PluginEditor | null = null;
    const push = (cb: (editor: PluginEditor | null) => void): (() => void) => {
      cb(open);
      return () => undefined;
    };
    const { host, registry } = makeHost({ getEditor: () => open, subscribeEditor: push });
    const seen: Array<PluginEditor | null> = [];
    await activate(host, registry, ['editor.read'], (c) => {
      c.onEditor?.((next) => {
        seen.push(next);
      });
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeNull();
  });

  it('removes the editor subscriptions on deactivate', async () => {
    const { editor } = makeEditor();
    let open: PluginEditor | null = null;
    const { host, registry } = makeHost({ getEditor: () => open });
    const seen: Array<PluginEditor | null> = [];
    const ctx = await activate(host, registry, ['editor.read'], (c) => {
      c.onEditor?.((next) => {
        seen.push(next);
      });
    });

    open = editor;
    expect(ctx!.editor).not.toBeNull();
    expect(seen).toHaveLength(2);

    await host.deactivate('perm.demo');

    // The subscription is gone: the plugin is not called anymore.
    open = null;
    host.emit('workspace.opened', { path: null });
    expect(seen).toHaveLength(2);
  });

  it('emits the "editor.available" event', async () => {
    const { editor } = makeEditor();
    let open: PluginEditor | null = null;
    const { host, registry } = makeHost({ getEditor: () => open });
    const paths: Array<string | null> = [];
    await activate(host, registry, [], (c) => {
      c.on('editor.available', (payload) => {
        paths.push(payload.path);
      });
    });

    open = editor;
    host.emit('workspace.opened', { path: null });
    expect(paths).toEqual(['notes/a.md']);
  });
});

/* --------------------------------------------------------- the settings store */

describe('the settings store checks the type of the stored value', () => {
  let store: SettingsStore;

  beforeEach(async () => {
    store = new SettingsStore();
    await store.reset('perm.settings');
  });

  it('falls back to the default when the type does not match', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await store.set('perm.settings', 'count', 'not-a-number' as never);
    expect(await store.get('perm.settings', 'count', 7)).toBe(7);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('expected number');
    warn.mockRestore();
  });

  it('keeps the values of the same type', async () => {
    await store.set('perm.settings', 'count', 42);
    expect(await store.get('perm.settings', 'count', 7)).toBe(42);

    await store.set('perm.settings', 'flag', true);
    expect(await store.get('perm.settings', 'flag', false)).toBe(true);

    await store.set('perm.settings', 'title', 'hello');
    expect(await store.get('perm.settings', 'title', 'fallback')).toBe('hello');
  });

  it('returns the stored value when there is no default to compare with', async () => {
    await store.set('perm.settings', 'free', 'anything');
    expect(await store.get('perm.settings', 'free', undefined)).toBe('anything');
  });
});

/* --------------------------------------------------------- the plugin lifecycle */

describe('the lifecycle of a plugin', () => {
  it('passes through the "validated" state', async () => {
    const { host, registry } = makeHost();
    const states: string[] = [];
    registry.onStateChange((_id, state) => states.push(state));
    registry.register({ manifest: manifest(), activate: () => undefined });
    registry.enable('perm.demo');
    await host.activate('perm.demo');

    expect(states).toEqual(['discovered', 'enabled', 'validated', 'loading', 'active']);
  });

  it('counts the event subscriptions and not every cleanup', async () => {
    const { host, registry } = makeHost();
    registry.register({
      manifest: manifest({ permissions: [] }),
      activate: (ctx) => {
        ctx.on('note.updated', () => undefined);
        ctx.on('note.created', () => undefined);
      },
    });
    registry.enable('perm.demo');
    await host.activate('perm.demo');

    expect(host.counts().events).toBe(2);

    await host.deactivate('perm.demo');
    expect(host.counts().events).toBe(0);
  });
});
