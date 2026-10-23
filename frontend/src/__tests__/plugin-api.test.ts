// Coverage of the public plugin API surface: manifest validation, the plugin
// registry, the plugin host lifecycle, the event bus, the command registry,
// the settings store and the scoped logger.
//
// The complementary cases live in `plugin-core.test.ts`; this file avoids
// duplicating them and focuses on the uncovered edges (id length limits,
// rejected activation promises, full cleanup on deactivate, corrupted values
// in IndexedDB, persistence across store instances, ...).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import {
  PLUGIN_API_VERSION,
  type Plugin,
  type PluginApi,
  type PluginContext,
  type PluginEventMap,
  type PluginManifest,
} from '../plugins/contract';
import { isCompatibleWithCurrentApi, validateManifest } from '../plugins/manifest';
import { PluginRegistry } from '../plugins/registry';
import { PluginHost } from '../plugins/host';
import { EventBus } from '../core/events/eventBus';
import { CommandRegistry } from '../core/commands/commandRegistry';
import { SettingsStore } from '../core/settings/settingsStore';
import { createLogger } from '../core/diagnostics/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'api.demo',
    name: 'API demo',
    version: '1.0.0',
    manifestVersion: 1,
    minApiVersion: PLUGIN_API_VERSION,
    permissions: ['notes.read', 'ui.contribute'],
    ...overrides,
  };
}

function makePlugin(
  m: PluginManifest,
  activate: (ctx: PluginContext) => void | Promise<void>,
  deactivate?: () => void | Promise<void>,
): Plugin {
  return { manifest: m, activate, deactivate };
}

/** A data API that never touches the network. */
function mockApi(): PluginApi {
  return {
    getNote: async (path) => ({ path, content: '', revision: 1, updatedAt: 'now', conflict: false }),
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

function makeHost() {
  const registry = new PluginRegistry();
  const bus = new EventBus<PluginEventMap>();
  const commands = new CommandRegistry();
  const settings = new SettingsStore();
  const host = new PluginHost({
    registry,
    bus,
    commands,
    settings,
    createApi: () => mockApi(),
    getEditor: () => null,
  });
  return { registry, bus, commands, settings, host };
}

// ---------------------------------------------------------------------------
// A. Manifest validation
// ---------------------------------------------------------------------------

describe('A. manifest validation', () => {
  it('accepts a manifest with settings, description and author', () => {
    const result = validateManifest(
      manifest({
        description: 'demo',
        author: 'noto',
        settings: [{ key: 'a', label: 'A', type: 'boolean', default: true }],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an empty id', () => {
    const result = validateManifest(manifest({ id: '' }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('id must match'))).toBe(true);
  });

  it('rejects an id that is too short', () => {
    const result = validateManifest(manifest({ id: 'a' }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('id must be between 2 and 64 characters long');
  });

  it('rejects an id that is too long', () => {
    const result = validateManifest(manifest({ id: 'a'.repeat(65) }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('id must be between 2 and 64 characters long');
  });

  it('rejects an id with characters outside the allowed set', () => {
    const result = validateManifest(manifest({ id: 'demo plugin' }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('id must match'))).toBe(true);
  });

  it('rejects an empty name', () => {
    const result = validateManifest(manifest({ name: '   ' }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('name must be a non-empty string');
  });

  it('rejects a version that is not a semantic version', () => {
    const result = validateManifest(manifest({ version: 'v1.0.0' }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('version must be a semantic version (x.y.z)');
  });

  it('rejects a manifest version other than 1', () => {
    const result = validateManifest(manifest({ manifestVersion: 2 as unknown as 1 }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('manifestVersion must be 1');
  });

  it('rejects an unknown permission', () => {
    const result = validateManifest(
      manifest({ permissions: ['notes.delete' as never] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('unknown permission: notes.delete');
  });

  it('rejects permissions that are not an array', () => {
    const result = validateManifest(
      manifest({ permissions: 'notes.read' as unknown as PluginManifest['permissions'] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('permissions must be an array');
  });

  it('rejects a settings schema with an unknown type', () => {
    const result = validateManifest(
      manifest({
        settings: [{ key: 'a', label: 'A', type: 'text' as never, default: 'x' }],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('settings[0].type must be one of string|number|boolean');
  });

  it('rejects a default whose type does not match the declared type', () => {
    const result = validateManifest(
      manifest({
        settings: [{ key: 'a', label: 'A', type: 'string', default: 5 as never }],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('settings[0].default must be a string');
  });

  it('rejects a settings list that is not an array', () => {
    const result = validateManifest(
      manifest({ settings: {} as unknown as PluginManifest['settings'] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('settings must be an array');
  });

  it('accepts a plugin for the current API and refuses a newer minor', () => {
    expect(isCompatibleWithCurrentApi(manifest({ minApiVersion: PLUGIN_API_VERSION }))).toBe(true);
    expect(isCompatibleWithCurrentApi(manifest({ minApiVersion: '1.99.0' }))).toBe(false);
    expect(isCompatibleWithCurrentApi(manifest({ minApiVersion: '2.0.0' }))).toBe(false);
    // A plugin requiring an older minor of the same major stays compatible.
    expect(isCompatibleWithCurrentApi(manifest({ minApiVersion: '1.0.0' }))).toBe(true);
    // A different major is never compatible.
    expect(isCompatibleWithCurrentApi(manifest({ minApiVersion: '0.9.0' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B. Plugin registry
// ---------------------------------------------------------------------------

describe('B. plugin registry', () => {
  it('registers a valid plugin and moves it to enabled', () => {
    const registry = new PluginRegistry();
    const result = registry.register(makePlugin(manifest(), () => {}));
    expect(result.ok).toBe(true);
    expect(registry.get('api.demo')?.state).toBe('discovered');
    expect(registry.get('api.demo')?.enabled).toBe(false);

    expect(registry.enable('api.demo')).toBe(true);
    expect(registry.get('api.demo')?.state).toBe('enabled');
    expect(registry.get('api.demo')?.enabled).toBe(true);
  });

  it('keeps the first plugin when a duplicate id is registered', () => {
    const registry = new PluginRegistry();
    const first = makePlugin(manifest({ name: 'First' }), () => {});
    const second = makePlugin(manifest({ name: 'Second' }), () => {});
    registry.register(first);
    const result = registry.register(second);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('already registered');
    expect(registry.get('api.demo')?.plugin).toBe(first);
    expect(registry.get('api.demo')?.plugin.manifest.name).toBe('First');
    expect(registry.list()).toHaveLength(1);
  });

  it('marks a plugin requiring a newer API as incompatible', () => {
    const registry = new PluginRegistry();
    const result = registry.register(makePlugin(manifest({ minApiVersion: '9.0.0' }), () => {}));
    expect(result.ok).toBe(false);
    const entry = registry.get('api.demo');
    expect(entry?.state).toBe('incompatible');
    expect(entry?.error).toContain('9.0.0');
    expect(entry?.error).toContain(PLUGIN_API_VERSION);
    expect(registry.enable('api.demo')).toBe(false);
  });

  it('marks a plugin with an invalid manifest as failed and reports the errors', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin(manifest({ name: '' }), () => {}));
    const entry = registry.get('api.demo');
    expect(entry?.state).toBe('failed');
    expect(entry?.error).toContain('name must be a non-empty string');
    expect(registry.enable('api.demo')).toBe(false);
  });

  it('toggles the enabled flag with enable/disable', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin(manifest(), () => {}));
    registry.enable('api.demo');
    expect(registry.get('api.demo')?.state).toBe('enabled');

    registry.disable('api.demo');
    expect(registry.get('api.demo')?.state).toBe('disabled');
    expect(registry.get('api.demo')?.enabled).toBe(false);

    registry.enable('api.demo');
    expect(registry.get('api.demo')?.state).toBe('enabled');
  });

  it('returns false for an unknown plugin', () => {
    const registry = new PluginRegistry();
    expect(registry.enable('nope')).toBe(false);
    expect(registry.disable('nope')).toBe(false);
    expect(registry.get('nope')).toBeUndefined();
  });

  it('announces state changes and can unsubscribe', () => {
    const registry = new PluginRegistry();
    const seen: string[] = [];
    const off = registry.onStateChange((id, state) => seen.push(`${id}:${state}`));
    registry.register(makePlugin(manifest(), () => {}));
    expect(seen).toEqual(['api.demo:discovered']);
    off();
    registry.enable('api.demo');
    expect(seen).toEqual(['api.demo:discovered']);
  });
});

// ---------------------------------------------------------------------------
// C. Plugin host
// ---------------------------------------------------------------------------

describe('C. plugin host', () => {
  it('activates a plugin through host.enable', async () => {
    const { registry, host } = makeHost();
    const activate = vi.fn();
    registry.register(makePlugin(manifest(), activate));
    await host.enable('api.demo');
    expect(activate).toHaveBeenCalledTimes(1);
    expect(registry.get('api.demo')?.state).toBe('active');
  });

  it('fails the plugin when activate throws, without breaking the caller', async () => {
    const { registry, host } = makeHost();
    registry.register(
      makePlugin(manifest(), () => {
        throw new Error('sync boom');
      }),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(host.activate('api.demo')).resolves.toBeUndefined();
    expect(registry.get('api.demo')?.state).toBe('failed');
    expect(registry.get('api.demo')?.error).toContain('sync boom');
    error.mockRestore();
  });

  it('fails the plugin when activate returns a rejected promise', async () => {
    const { registry, host } = makeHost();
    registry.register(
      makePlugin(manifest(), async () => {
        throw new Error('async boom');
      }),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(host.activate('api.demo')).resolves.toBeUndefined();
    expect(registry.get('api.demo')?.state).toBe('failed');
    expect(registry.get('api.demo')?.error).toContain('async boom');
    error.mockRestore();
  });

  it('removes every registration of the plugin on deactivate', async () => {
    const { registry, host, commands, bus } = makeHost();
    registry.register(
      makePlugin(manifest(), (c) => {
        c.registerCommand({ id: 'demo.cmd', title: 'Cmd', run: () => {} });
        c.registerPanel({ id: 'demo.panel', title: 'Panel', render: () => null });
        c.registerSidebarItem({ id: 'demo.side', title: 'Side', onSelect: () => {} });
        c.registerContextMenuItem({
          id: 'demo.menu',
          title: 'Menu',
          appliesTo: () => true,
          run: () => {},
        });
        c.registerToolbarItem({ id: 'demo.tool', title: 'Tool', run: () => {} });
        c.registerSettingsSection({ id: 'demo.set', title: 'Set', render: () => null });
        c.on('note.updated', () => {});
      }),
    );
    registry.enable('api.demo');
    await host.activate('api.demo');

    expect(host.counts()).toMatchObject({
      commands: 1,
      panels: 1,
      sidebarItems: 1,
      contextMenuItems: 1,
      toolbarItems: 1,
      settingsSections: 1,
    });
    expect(bus.listenerCount('note.updated')).toBe(1);

    await host.deactivate('api.demo');

    expect(commands.has('demo.cmd')).toBe(false);
    expect(host.panels()).toHaveLength(0);
    expect(host.sidebarItems()).toHaveLength(0);
    expect(host.contextMenuItems()).toHaveLength(0);
    expect(host.toolbarItems()).toHaveLength(0);
    expect(host.settingsSections()).toHaveLength(0);
    expect(bus.listenerCount('note.updated')).toBe(0);
    expect(host.counts()).toMatchObject({
      plugins: 0,
      commands: 0,
      panels: 0,
      sidebarItems: 0,
      contextMenuItems: 0,
      toolbarItems: 0,
      settingsSections: 0,
    });
  });

  it('calls the plugin deactivate hook on deactivate', async () => {
    const { registry, host } = makeHost();
    const deactivate = vi.fn();
    registry.register(makePlugin(manifest(), () => {}, deactivate));
    registry.enable('api.demo');
    await host.activate('api.demo');
    await host.deactivate('api.demo');
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(registry.get('api.demo')?.state).toBe('disabled');
  });

  it('survives a throwing deactivate hook', async () => {
    const { registry, host } = makeHost();
    registry.register(
      makePlugin(
        manifest(),
        () => {},
        () => {
          throw new Error('deactivate boom');
        },
      ),
    );
    registry.enable('api.demo');
    await host.activate('api.demo');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(host.deactivate('api.demo')).resolves.toBeUndefined();
    expect(registry.get('api.demo')?.state).toBe('disabled');
    error.mockRestore();
  });

  it('keeps exactly one command and one listener after a reactivate cycle', async () => {
    const { registry, host, commands, bus } = makeHost();
    registry.register(
      makePlugin(manifest(), (c) => {
        c.registerCommand({ id: 'demo.cmd', title: 'Cmd', run: () => {} });
        c.on('note.updated', () => {});
      }),
    );
    registry.enable('api.demo');
    await host.activate('api.demo');
    await host.deactivate('api.demo');
    await host.activate('api.demo');

    expect(commands.list().filter((c) => c.id === 'demo.cmd')).toHaveLength(1);
    expect(commands.count()).toBe(1);
    expect(bus.listenerCount('note.updated')).toBe(1);
    expect(host.counts().plugins).toBe(1);
  });

  it('delivers an emitted event to the plugin subscriber', async () => {
    const { registry, host } = makeHost();
    const seen: string[] = [];
    registry.register(
      makePlugin(manifest(), (c) => {
        c.on('note.updated', (payload) => seen.push(payload.path));
      }),
    );
    registry.enable('api.demo');
    await host.activate('api.demo');
    host.emit('note.updated', { path: 'a.md', revision: 2 });
    expect(seen).toEqual(['a.md']);
  });

  it('does not let a throwing subscriber break the delivery to the others', async () => {
    const { registry, host, bus } = makeHost();
    const seen: string[] = [];
    bus.on('note.updated', () => {
      throw new Error('subscriber boom');
    });
    registry.register(
      makePlugin(manifest(), (c) => {
        c.on('note.updated', (payload) => seen.push(payload.path));
      }),
    );
    registry.enable('api.demo');
    await host.activate('api.demo');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => host.emit('note.updated', { path: 'a.md', revision: 1 })).not.toThrow();
    expect(seen).toEqual(['a.md']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('deactivates every plugin in disposeAll', async () => {
    const { registry, host, commands, bus } = makeHost();
    registry.register(
      makePlugin(manifest({ id: 'api.one' }), (c) => {
        c.registerCommand({ id: 'one.cmd', title: 'One', run: () => {} });
        c.on('note.updated', () => {});
      }),
    );
    registry.register(
      makePlugin(manifest({ id: 'api.two' }), (c) => {
        c.registerCommand({ id: 'two.cmd', title: 'Two', run: () => {} });
      }),
    );
    registry.enable('api.one');
    registry.enable('api.two');
    await host.activate('api.one');
    await host.activate('api.two');
    expect(host.counts().plugins).toBe(2);

    await host.disposeAll();

    expect(host.counts().plugins).toBe(0);
    expect(commands.count()).toBe(0);
    expect(bus.listenerCount('note.updated')).toBe(0);
    expect(registry.get('api.one')?.state).toBe('disabled');
    expect(registry.get('api.two')?.state).toBe('disabled');
  });
});

// ---------------------------------------------------------------------------
// D. Event bus
// ---------------------------------------------------------------------------

describe('D. event bus', () => {
  it('stops calling a subscriber after the unsubscribe function was called', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    const calls: number[] = [];
    const off = bus.on('ping', (p) => calls.push(p.n));
    bus.emit('ping', { n: 1 });
    off();
    bus.emit('ping', { n: 2 });
    expect(calls).toEqual([1]);
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('reports the number of subscribers and zero for unknown events', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    expect(bus.listenerCount('ping')).toBe(0);
    bus.on('ping', () => {});
    bus.on('ping', () => {});
    expect(bus.listenerCount('ping')).toBe(2);
    expect(bus.listenerCount('pong')).toBe(0);
  });

  it('does not deliver the same event twice when a handler re-emits it', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    let depth = 0;
    let maxDepth = 0;
    let calls = 0;
    bus.on('ping', () => {
      calls += 1;
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      bus.emit('ping', { n: 1 });
      depth -= 1;
    });
    bus.emit('ping', { n: 1 });
    expect(calls).toBe(1);
    expect(maxDepth).toBe(1);
  });

  it('still delivers a different event from inside a handler', () => {
    const bus = new EventBus<{ ping: { n: number }; pong: { n: number } }>();
    const seen: string[] = [];
    bus.on('ping', () => {
      seen.push('ping');
      bus.emit('pong', { n: 1 });
    });
    bus.on('pong', () => seen.push('pong'));
    bus.emit('ping', { n: 1 });
    expect(seen).toEqual(['ping', 'pong']);
  });
});

// ---------------------------------------------------------------------------
// E. Command registry
// ---------------------------------------------------------------------------

describe('E. command registry', () => {
  it('runs a registered command', async () => {
    const commands = new CommandRegistry();
    const run = vi.fn();
    commands.register('owner', { id: 'cmd', title: 'Cmd', run });
    expect(commands.has('cmd')).toBe(true);
    await commands.run('cmd');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses a duplicate id and keeps the first command', () => {
    const commands = new CommandRegistry();
    const first = vi.fn();
    const second = vi.fn();
    commands.register('owner', { id: 'cmd', title: 'First', run: first });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    commands.register('owner', { id: 'cmd', title: 'Second', run: second });
    expect(commands.list()).toHaveLength(1);
    expect(commands.list()[0].title).toBe('First');
    commands.run('cmd');
    expect(first).toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('removes only the commands of the given owner', () => {
    const commands = new CommandRegistry();
    commands.register('a', { id: 'a1', title: 'A1', run: () => {} });
    commands.register('a', { id: 'a2', title: 'A2', run: () => {} });
    commands.register('b', { id: 'b1', title: 'B1', run: () => {} });
    expect(commands.count('a')).toBe(2);
    expect(commands.count('b')).toBe(1);

    commands.unregisterAll('a');

    expect(commands.count('a')).toBe(0);
    expect(commands.count()).toBe(1);
    expect(commands.has('a1')).toBe(false);
    expect(commands.has('b1')).toBe(true);
  });

  it('does not throw for an unknown command', () => {
    const commands = new CommandRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => commands.run('missing')).not.toThrow();
    expect(commands.run('missing')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('unregisters idempotently via the returned function', () => {
    const commands = new CommandRegistry();
    const off = commands.register('owner', { id: 'cmd', title: 'Cmd', run: () => {} });
    off();
    off();
    expect(commands.has('cmd')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F. Settings store
// ---------------------------------------------------------------------------

describe('F. settings store', () => {
  let store: SettingsStore;

  beforeEach(async () => {
    store = new SettingsStore();
    await store.reset('api.settings');
    await store.reset('api.other');
  });

  it('returns the stored value after set', async () => {
    await store.set('api.settings', 'theme', 'dark');
    expect(await store.get('api.settings', 'theme', 'light')).toBe('dark');
  });

  it('does not leak the values of another plugin into getAll', async () => {
    await store.set('api.settings', 'own', 1);
    await store.set('api.other', 'foreign', 2);
    expect(await store.getAll('api.settings')).toEqual({ own: 1 });
    expect(await store.getAll('api.other')).toEqual({ foreign: 2 });
  });

  it('resets every setting of a plugin back to the defaults', async () => {
    await store.set('api.settings', 'a', 'x');
    await store.set('api.settings', 'b', 'y');
    await store.reset('api.settings');
    expect(await store.getAll('api.settings')).toEqual({});
    expect(await store.get('api.settings', 'a', 'default-a')).toBe('default-a');
    expect(await store.get('api.settings', 'b', 'default-b')).toBe('default-b');
  });

  it('resets a single setting of a plugin', async () => {
    await store.set('api.settings', 'a', 'x');
    await store.set('api.settings', 'b', 'y');
    await store.reset('api.settings', 'a');
    expect(await store.get('api.settings', 'a', 'default-a')).toBe('default-a');
    expect(await store.get('api.settings', 'b', 'default-b')).toBe('y');
  });

  it('falls back to the default when the stored value is corrupted', async () => {
    // Ensure the database (and its object stores) exist before writing to it.
    await store.get('api.settings', 'count', 0);
    const db = await openDB('noto-plugins', 1);
    await db.put('settings', {
      key: 'api.settings:count',
      pluginId: 'api.settings',
      name: 'count',
      value: new Map([['broken', true]]),
    });
    db.close();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const value = await store.get('api.settings', 'count', 7);
    expect(value).toBe(7);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('corrupted value');
    warn.mockRestore();
  });

  it('falls back to the default when the stored value has the wrong type', async () => {
    // A stored value whose type does not match the default is treated as
    // corrupted: `get()` returns the default and warns about the mismatch.
    await store.set('api.settings', 'count', 'not-a-number' as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const value = await store.get('api.settings', 'count', 7);
    expect(value).toBe(7);
    expect(warn).toHaveBeenCalled();
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('[noto:settings]');
    expect(message).toContain('api.settings:count');
    expect(message).toContain('using default');
    warn.mockRestore();
  });

  it('keeps the values after the store is recreated', async () => {
    await store.set('api.settings', 'persisted', 'yes');
    const fresh = new SettingsStore();
    expect(await fresh.get('api.settings', 'persisted', 'no')).toBe('yes');
    expect(await fresh.getAll('api.settings')).toEqual({ persisted: 'yes' });
  });

  it('stores and replaces the enabled states', async () => {
    await store.setEnabledStates({ 'api.settings': true, 'api.other': false });
    expect(await store.getEnabledStates()).toEqual({
      'api.settings': true,
      'api.other': false,
    });

    await store.setEnabledStates({ 'api.settings': false });
    expect(await store.getEnabledStates()).toEqual({ 'api.settings': false });
  });
});

// ---------------------------------------------------------------------------
// G. Logger
// ---------------------------------------------------------------------------

describe('G. logger', () => {
  it('prefixes every level with the scope', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = createLogger('api.demo');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(debug).toHaveBeenCalledWith('[noto:api.demo]', 'd');
    expect(info).toHaveBeenCalledWith('[noto:api.demo]', 'i');
    expect(warn).toHaveBeenCalledWith('[noto:api.demo]', 'w');
    expect(error).toHaveBeenCalledWith('[noto:api.demo]', 'e');

    debug.mockRestore();
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it('passes extra arguments through and never throws', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logger = createLogger('api.demo');
    expect(() => logger.info('msg', 1, { a: 2 }, undefined, null)).not.toThrow();
    expect(info).toHaveBeenCalledWith('[noto:api.demo]', 'msg', 1, { a: 2 }, undefined, null);
    info.mockRestore();
  });
});
