import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  PLUGIN_API_VERSION,
  type Plugin,
  type PluginContext,
  type PluginManifest,
  type PluginEventMap,
  type PluginPanel,
} from '../plugins/contract';
import { isCompatible, validateManifest } from '../plugins/manifest';
import { PluginRegistry } from '../plugins/registry';
import { PluginHost } from '../plugins/host';
import { builtinPlugins } from '../plugins/loader';
import { EventBus } from '../core/events/eventBus';
import { CommandRegistry } from '../core/commands/commandRegistry';
import { SettingsStore } from '../core/settings/settingsStore';
import { createLogger } from '../core/diagnostics/logger';
import { createPluginApi } from '../core/api/pluginApi';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'demo.plugin',
    name: 'Demo plugin',
    version: '1.0.0',
    manifestVersion: 1,
    minApiVersion: PLUGIN_API_VERSION,
    // The demo plugin registers UI contributions and writes its settings,
    // so it declares the permissions the host enforces.
    permissions: ['notes.read', 'ui.contribute', 'settings.write'],
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

describe('manifest validation', () => {
  it('accepts a valid manifest', () => {
    const result = validateManifest(manifest());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a bad id, version and permission', () => {
    const result = validateManifest(
      manifest({ id: 'Bad Id!', version: '1.0', permissions: ['nope' as never] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects duplicated permissions and setting keys', () => {
    const result = validateManifest(
      manifest({
        permissions: ['notes.read', 'notes.read'],
        settings: [
          { key: 'a', label: 'A', type: 'string', default: 'x' },
          { key: 'a', label: 'A2', type: 'string', default: 'y' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a default that does not match the setting type', () => {
    const result = validateManifest(
      manifest({ settings: [{ key: 'n', label: 'N', type: 'number', default: 'x' as never }] }),
    );
    expect(result.ok).toBe(false);
  });

  it('compares versions for compatibility', () => {
    expect(isCompatible('1.0.0', '1.0.0')).toBe(true);
    expect(isCompatible('1.0.0', '1.2.0')).toBe(true);
    expect(isCompatible('1.3.0', '1.2.0')).toBe(false);
    expect(isCompatible('2.0.0', '1.2.0')).toBe(false);
    expect(isCompatible('not-a-version', '1.2.0')).toBe(false);
  });
});

describe('event bus', () => {
  it('delivers synchronously in registration order', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    const seen: string[] = [];
    bus.on('ping', () => seen.push('a'));
    bus.on('ping', () => seen.push('b'));
    bus.emit('ping', { n: 1 });
    expect(seen).toEqual(['a', 'b']);
    expect(bus.listenerCount('ping')).toBe(2);
  });

  it('isolates a failing subscriber', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: number[] = [];
    bus.on('ping', () => {
      throw new Error('boom');
    });
    bus.on('ping', (p) => seen.push(p.n));
    bus.emit('ping', { n: 7 });
    expect(seen).toEqual([7]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores recursive emission of the same event', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    let calls = 0;
    bus.on('ping', () => {
      calls += 1;
      bus.emit('ping', { n: 1 });
    });
    bus.emit('ping', { n: 1 });
    expect(calls).toBe(1);
  });

  it('unsubscribes idempotently', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    const off = bus.on('ping', () => {});
    off();
    off();
    expect(bus.listenerCount('ping')).toBe(0);
  });
});

describe('command registry', () => {
  it('refuses a duplicate id and unregisters by owner', () => {
    const commands = new CommandRegistry();
    const first = vi.fn();
    commands.register('p1', { id: 'c1', title: 'C1', run: first });
    commands.register('p2', { id: 'c1', title: 'Other', run: vi.fn() });
    expect(commands.list()).toHaveLength(1);
    expect(commands.list()[0].title).toBe('C1');

    commands.unregisterAll('p1');
    expect(commands.has('c1')).toBe(false);
  });

  it('runs a command', async () => {
    const commands = new CommandRegistry();
    const run = vi.fn();
    commands.register('p1', { id: 'c1', title: 'C1', run });
    await commands.run('c1');
    expect(run).toHaveBeenCalled();
  });
});

describe('settings store', () => {
  let store: SettingsStore;

  beforeEach(async () => {
    store = new SettingsStore();
    await store.reset('demo.settings');
    await store.reset('other.settings');
  });

  it('isolates plugin namespaces', async () => {
    await store.set('demo.settings', 'k', 'v1');
    await store.set('other.settings', 'k', 'v2');
    expect(await store.get('demo.settings', 'k', 'fallback')).toBe('v1');
    expect(await store.get('other.settings', 'k', 'fallback')).toBe('v2');
    expect(await store.getAll('demo.settings')).toEqual({ k: 'v1' });
  });

  it('falls back when a value is missing', async () => {
    expect(await store.get('demo.settings', 'missing', 42)).toBe(42);
  });

  it('rejects non JSON compatible values', async () => {
    await expect(store.set('demo.settings', 'bad', (() => 1) as never)).rejects.toThrow();
  });

  it('persists enabled states', async () => {
    await store.setEnabledStates({ 'demo.settings': true });
    expect(await store.getEnabledStates()).toEqual({ 'demo.settings': true });
  });

  it('migrates stored settings to a new schema version', async () => {
    await store.set('demo.settings', 'count', 1);
    const migrated = await store.migrateSettings('demo.settings', 2, {
      '0': (v) => (typeof v === 'number' ? v + 10 : v),
      '1': (v) => (typeof v === 'number' ? v + 100 : v),
    });
    // One value converted twice (version 0 -> 1 -> 2).
    expect(migrated).toBe(2);
    expect(await store.get('demo.settings', 'count', 0)).toBe(111);
  });
});

describe('logger', () => {
  it('prefixes messages with the scope', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    createLogger('demo.plugin').info('hello');
    expect(spy).toHaveBeenCalledWith('[noto:demo.plugin]', 'hello');
    spy.mockRestore();
  });
});

describe('plugin api', () => {
  it('delegates to the api modules and passes the revision', async () => {
    const saveNote = vi.fn(async () => ({ path: 'a.md', content: '', revision: 2, updatedAt: 'now' }));
    const api = createPluginApi({ saveNote });
    await api.saveNote('a.md', 'text', 2);
    expect(saveNote).toHaveBeenCalledWith('a.md', 'text', 2);
  });

  it('propagates the revision conflict error unchanged', async () => {
    const conflict = Object.assign(new Error('conflict'), { code: 'revision_conflict' });
    const api = createPluginApi({
      saveNote: async () => {
        throw conflict;
      },
    });
    await expect(api.saveNote('a.md', 'text', 1)).rejects.toBe(conflict);
  });
});

describe('registry and host', () => {
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
      createApi: () => createPluginApi(),
      getEditor: () => null,
    });
    return { registry, bus, commands, settings, host };
  }

  it('refuses a duplicate plugin id', () => {
    const { registry } = makeHost();
    const plugin = makePlugin(manifest(), () => {});
    expect(registry.register(plugin).ok).toBe(true);
    const again = registry.register(plugin);
    expect(again.ok).toBe(false);
    expect(again.error).toContain('already registered');
  });

  it('marks an incompatible plugin as incompatible', () => {
    const { registry } = makeHost();
    const result = registry.register(makePlugin(manifest({ minApiVersion: '9.0.0' }), () => {}));
    expect(result.ok).toBe(false);
    expect(registry.get('demo.plugin')?.state).toBe('incompatible');
  });

  it('marks an invalid manifest as failed', () => {
    const { registry } = makeHost();
    registry.register(makePlugin(manifest({ id: 'BAD ID' }), () => {}));
    expect(registry.get('BAD ID')?.state).toBe('failed');
  });

  it('activates a plugin and exposes its registrations', async () => {
    const { registry, host, commands, bus } = makeHost();
    let ctx: PluginContext | null = null;
    const plugin = makePlugin(manifest(), (c) => {
      ctx = c;
      c.registerCommand({ id: 'demo.hello', title: 'Hello', run: () => {} });
      c.registerPanel({ id: 'demo.panel', title: 'Panel', render: () => null });
      c.registerSidebarItem({ id: 'demo.side', title: 'Side', onSelect: () => {} });
      c.registerToolbarItem({ id: 'demo.tool', title: 'Tool', run: () => {} });
      c.registerContextMenuItem({ id: 'demo.menu', title: 'Menu', appliesTo: () => true, run: () => {} });
      c.registerSettingsSection({ id: 'demo.settings', title: 'Settings', render: () => null });
      c.on('note.updated', () => {});
    });
    registry.register(plugin);
    registry.enable('demo.plugin');
    await host.activate('demo.plugin');

    expect(registry.get('demo.plugin')?.state).toBe('active');
    expect(ctx).not.toBeNull();
    expect(commands.has('demo.hello')).toBe(true);
    expect(host.panels()).toHaveLength(1);
    expect(host.sidebarItems()).toHaveLength(1);
    expect(host.toolbarItems()).toHaveLength(1);
    expect(host.contextMenuItems()).toHaveLength(1);
    expect(host.settingsSections()).toHaveLength(1);
    expect(bus.listenerCount('note.updated')).toBe(1);
  });

  it('keeps working when a plugin throws during activation', async () => {
    const { registry, host } = makeHost();
    registry.register(
      makePlugin(manifest(), () => {
        throw new Error('plugin exploded');
      }),
    );
    registry.enable('demo.plugin');
    await expect(host.activate('demo.plugin')).resolves.toBeUndefined();
    expect(registry.get('demo.plugin')?.state).toBe('failed');
    expect(registry.get('demo.plugin')?.error).toContain('plugin exploded');
  });

  it('removes every registration on deactivate', async () => {
    const { registry, host, commands, bus } = makeHost();
    registry.register(
      makePlugin(manifest(), (c) => {
        c.registerCommand({ id: 'demo.hello', title: 'Hello', run: () => {} });
        c.registerPanel({ id: 'demo.panel', title: 'Panel', render: () => null });
        c.on('note.updated', () => {});
      }),
    );
    registry.enable('demo.plugin');
    await host.activate('demo.plugin');
    await host.deactivate('demo.plugin');

    expect(commands.has('demo.hello')).toBe(false);
    expect(host.panels()).toHaveLength(0);
    expect(bus.listenerCount('note.updated')).toBe(0);
    expect(registry.get('demo.plugin')?.state).toBe('disabled');
  });

  it('does not duplicate registrations on repeated activate/deactivate cycles', async () => {
    const { registry, host, commands, bus } = makeHost();
    registry.register(
      makePlugin(manifest(), (c) => {
        c.registerCommand({ id: 'demo.hello', title: 'Hello', run: () => {} });
        c.on('note.updated', () => {});
      }),
    );
    registry.enable('demo.plugin');
    await host.activate('demo.plugin');
    await host.deactivate('demo.plugin');
    await host.activate('demo.plugin');
    await host.deactivate('demo.plugin');

    expect(commands.count()).toBe(0);
    expect(bus.listenerCount('note.updated')).toBe(0);
    expect(host.counts().plugins).toBe(0);
  });

  it('runs deactivate callbacks in reverse order', async () => {
    const { registry, host } = makeHost();
    const order: string[] = [];
    registry.register(
      makePlugin(manifest(), (c) => {
        c.onDeactivate(() => order.push('first'));
        c.onDeactivate(() => order.push('second'));
      }),
    );
    registry.enable('demo.plugin');
    await host.activate('demo.plugin');
    await host.deactivate('demo.plugin');
    expect(order).toEqual(['second', 'first']);
  });

  it('gives the plugin its own settings namespace', async () => {
    const { registry, host, settings } = makeHost();
    await settings.set('other.plugin', 'k', 'other');
    let ctx: PluginContext | null = null;
    registry.register(
      makePlugin(
        manifest({ settings: [{ key: 'k', label: 'K', type: 'string', default: 'default' }] }),
        (c) => {
          ctx = c;
        },
      ),
    );
    registry.enable('demo.plugin');
    await host.activate('demo.plugin');
    expect(await ctx!.settings.get('k')).toBe('default');
    await ctx!.settings.set('k', 'mine');
    expect(await settings.get('other.plugin', 'k', 'fallback')).toBe('other');
    expect(await ctx!.settings.all()).toEqual({ k: 'mine' });
  });

  it('emits events through the bus', async () => {
    const { registry, host, bus } = makeHost();
    const seen: string[] = [];
    bus.on('note.updated', (p) => seen.push(`${p.path}@${p.revision}`));
    registry.register(makePlugin(manifest(), () => {}));
    registry.enable('demo.plugin');
    await host.activate('demo.plugin');
    host.emit('note.updated', { path: 'a.md', revision: 3 });
    expect(seen).toEqual(['a.md@3']);
  });
});

describe('builtin loader', () => {
  it('exposes a static (empty by default) plugin list', () => {
    expect(Array.isArray(builtinPlugins)).toBe(true);
    for (const plugin of builtinPlugins) {
      expect(plugin.manifest.id).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    }
  });

  it('keeps the built-in plugins compatible with API 1.1.0 without any change', () => {
    // The built-in plugins were written for API 1.0.0 and were NOT touched
    // by the additive bump: they must keep working unchanged.
    expect(builtinPlugins.length).toBeGreaterThan(0);
    for (const plugin of builtinPlugins) {
      expect(plugin.manifest.minApiVersion).toBe('1.0.0');
      expect(isCompatible(plugin.manifest.minApiVersion, PLUGIN_API_VERSION)).toBe(true);
    }
  });

  it('activates the built-in plugins without any vault state', async () => {
    const registry = new PluginRegistry();
    const bus = new EventBus<PluginEventMap>();
    const commands = new CommandRegistry();
    const settings = new SettingsStore();
    const host = new PluginHost({
      registry,
      bus,
      commands,
      settings,
      createApi: () => createPluginApi(),
      getEditor: () => null,
    });
    for (const plugin of builtinPlugins) {
      registry.register(plugin);
      registry.enable(plugin.manifest.id);
      await host.activate(plugin.manifest.id);
      expect(registry.get(plugin.manifest.id)?.state).toBe('active');
    }
  });
});

// Type level check: a panel renders Preact children.
const _panelTypeCheck: PluginPanel = {
  id: 'x',
  title: 'X',
  render: () => null,
};
void _panelTypeCheck;
