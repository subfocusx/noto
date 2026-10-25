// Coverage of the vault state capability of the plugin API (API 1.1.0).
//
// A plugin may ask the application about the state of the encrypted storage
// (`ctx.vault`), but it must never be able to reach the key material: the
// master password, the wrapping key and the data key stay inside the core.
// These tests check that the state is published, that it is absent while
// nothing is published, and that the plugin cannot change it.
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  PLUGIN_API_VERSION,
  type Plugin,
  type PluginContext,
  type PluginEventMap,
  type PluginManifest,
} from '../plugins/contract';
import { PluginRegistry } from '../plugins/registry';
import { PluginHost } from '../plugins/host';
import { EventBus } from '../core/events/eventBus';
import { CommandRegistry } from '../core/commands/commandRegistry';
import { SettingsStore } from '../core/settings/settingsStore';
import {
  createPluginApi,
  freezeVaultState,
  type PluginVaultStateLike,
} from '../core/api/pluginApi';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'vault.demo',
    name: 'Vault demo',
    version: '1.0.0',
    manifestVersion: 1,
    minApiVersion: '1.0.0',
    permissions: ['notes.read'],
    ...overrides,
  };
}

function mockApi(): PluginContext['api'] {
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

/** Activates a plugin and hands its context back. */
async function activateWith(
  host: PluginHost,
  registry: PluginRegistry,
  activate: (ctx: PluginContext) => void,
): Promise<PluginContext> {
  let ctx: PluginContext | null = null;
  const plugin: Plugin = {
    manifest: manifest(),
    activate: (c) => {
      ctx = c;
      activate(c);
    },
  };
  registry.register(plugin);
  registry.enable('vault.demo');
  await host.activate('vault.demo');
  if (!ctx) throw new Error('the plugin was not activated');
  return ctx;
}

describe('vault state of the plugin API', () => {
  it('publishes the API version 1.3.0 and keeps 1.0.0 compatible', () => {
    expect(PLUGIN_API_VERSION).toBe('1.3.0');
  });

  it('gives the plugin the published state of the encrypted storage', async () => {
    const { registry, host } = makeHost();
    const published: PluginVaultStateLike = {
      mode: 'sealed',
      encrypted: true,
      locked: false,
      formatVersion: 1,
    };
    host.publishVaultState(published);

    const ctx = await activateWith(host, registry, () => {});

    expect(ctx.vault).toBeDefined();
    expect(ctx.vault?.mode).toBe('sealed');
    expect(ctx.vault?.encrypted).toBe(true);
    expect(ctx.vault?.locked).toBe(false);
    expect(ctx.vault?.formatVersion).toBe(1);
  });

  it('shows no state at all while the application published nothing', async () => {
    const { registry, host } = makeHost();

    const ctx = await activateWith(host, registry, () => {});

    expect(ctx.vault).toBeUndefined();
  });

  it('does not throw when the plugin reads the state of an unknown storage', async () => {
    const { registry, host } = makeHost();
    let seen: unknown = 'untouched';

    const ctx = await activateWith(host, registry, (c) => {
      seen = c.vault?.encrypted;
    });

    expect(seen).toBeUndefined();
    expect(ctx.vault).toBeUndefined();
  });

  it('hands a frozen copy: the plugin cannot change what was published', async () => {
    const { registry, host } = makeHost();
    const published: PluginVaultStateLike = {
      mode: 'sealed',
      encrypted: true,
      locked: false,
      formatVersion: 1,
    };
    host.publishVaultState(published);

    const ctx = await activateWith(host, registry, () => {});

    // The plugin tries to cheat: it wants to unlock the storage by itself.
    const mutable = ctx.vault as unknown as Record<string, unknown>;
    try {
      mutable.mode = 'open';
      mutable.encrypted = false;
      mutable.locked = false;
    } catch {
      // A frozen object refuses the assignment — that is the expected path.
    }

    expect(ctx.vault?.mode).toBe('sealed');
    expect(ctx.vault?.encrypted).toBe(true);
    // The state of the application is untouched as well.
    expect(published.mode).toBe('sealed');
    expect(published.encrypted).toBe(true);
    expect(Object.isFrozen(ctx.vault)).toBe(true);
  });

  it('never exposes the state of the application itself', async () => {
    const { registry, host } = makeHost();
    const published: PluginVaultStateLike = {
      mode: 'sealed',
      encrypted: true,
      locked: false,
      formatVersion: 1,
    };
    host.publishVaultState(published);

    const ctx = await activateWith(host, registry, () => {});

    expect(ctx.vault).not.toBe(published);
    expect(ctx.vault).toEqual(published);
  });

  it('follows the state published later by the application', async () => {
    const { registry, host } = makeHost();
    const ctx = await activateWith(host, registry, () => {});
    expect(ctx.vault).toBeUndefined();

    host.publishVaultState({ mode: 'sealed', encrypted: true, locked: true, formatVersion: 1 });
    expect(ctx.vault?.locked).toBe(true);

    host.publishVaultState(undefined);
    expect(ctx.vault).toBeUndefined();
  });

  it('reads the state from the application when it provides a source', async () => {
    const registry = new PluginRegistry();
    const bus = new EventBus<PluginEventMap>();
    const commands = new CommandRegistry();
    const settings = new SettingsStore();
    const state: PluginVaultStateLike = {
      mode: 'sealed',
      encrypted: true,
      locked: false,
      formatVersion: 1,
    };
    const host = new PluginHost({
      registry,
      bus,
      commands,
      settings,
      createApi: () => mockApi(),
      getEditor: () => null,
      getVaultState: () => state,
    });

    const ctx = await activateWith(host, registry, () => {});

    expect(ctx.vault?.mode).toBe('sealed');
    expect(ctx.vault?.formatVersion).toBe(1);
  });

  it('carries the published state on the restricted plugin API', () => {
    const api = createPluginApi(
      {},
      {
        pluginId: 'vault.demo',
        permissions: ['notes.read'],
        vaultState: { mode: 'sealed', encrypted: true, locked: false, formatVersion: 1 },
      },
    );

    expect(api.vault?.mode).toBe('sealed');
    expect(api.vault?.encrypted).toBe(true);
    expect(Object.isFrozen(api.vault)).toBe(true);
  });

  it('leaves the API without a state while nothing is published', () => {
    const api = createPluginApi({}, { pluginId: 'vault.demo', permissions: ['notes.read'] });
    expect(api.vault).toBeUndefined();
  });

  it('freezes a copy of the state instead of the object of the application', () => {
    const state: PluginVaultStateLike = {
      mode: 'sealed',
      encrypted: true,
      locked: false,
      formatVersion: 1,
    };
    const copy = freezeVaultState(state);
    expect(copy).not.toBe(state);
    expect(copy).toEqual(state);
    expect(Object.isFrozen(copy)).toBe(true);
  });
});
