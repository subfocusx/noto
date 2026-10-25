// The operation that opens a note (API 1.3.0).
//
// The contract of the plugins offers `ctx.openNote(path)`: a plugin navigates
// to a note of the vault. The operation needs the permission `notes.read`
// (a plugin navigates only to a note it is allowed to read) and the action is
// recorded in the audit log of the host.
//
// The built-in `backlinks` plugin uses the operation: the backlinks of the
// panel are links that open the note.
import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/preact';
import {
  PLUGIN_API_VERSION,
  PluginPermissionError,
  type Plugin,
  type PluginManifest,
} from '../plugins/contract';
import { PluginHost } from '../plugins/host';
import { PluginRegistry } from '../plugins/registry';
import { EventBus } from '../core/events/eventBus';
import { CommandRegistry } from '../core/commands/commandRegistry';
import { SettingsStore } from '../core/settings/settingsStore';
import { createPluginApi } from '../core/api/pluginApi';
import { BacklinksStore, BacklinksView } from '../plugins/builtin/backlinks/index';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'open-note.demo',
    name: 'Open note demo',
    version: '1.0.0',
    manifestVersion: 1,
    minApiVersion: '1.3.0',
    permissions: ['notes.read'],
    ...overrides,
  };
}

/** Builds a host with the given dependencies. */
function makeHost(overrides: Partial<ConstructorParameters<typeof PluginHost>[0]> = {}) {
  const registry = new PluginRegistry();
  const host = new PluginHost({
    registry,
    bus: new EventBus(),
    commands: new CommandRegistry(),
    settings: new SettingsStore(),
    createApi: () => createPluginApi(),
    getEditor: () => null,
    ...overrides,
  });
  return { registry, host };
}

describe('the operation that opens a note', () => {
  it('publishes the API version 1.3.0', () => {
    expect(PLUGIN_API_VERSION).toBe('1.3.0');
  });

  it('opens the note through the host', async () => {
    const openNote = vi.fn();
    const { registry, host } = makeHost({ openNote });
    let seen: string | null = null;
    const plugin: Plugin = {
      manifest: manifest(),
      activate(ctx): void {
        seen = typeof ctx.openNote === 'function' ? 'yes' : 'no';
        ctx.openNote?.('notes/alpha.md');
      },
    };
    registry.register(plugin);
    await host.activate('open-note.demo');
    expect(seen).toBe('yes');
    expect(openNote).toHaveBeenCalledWith('notes/alpha.md');
  });

  it('refuses a plugin without the permission notes.read', async () => {
    const openNote = vi.fn();
    const { registry, host } = makeHost({ openNote });
    let error: unknown = null;
    const plugin: Plugin = {
      manifest: manifest({ permissions: ['editor.read'] }),
      activate(ctx): void {
        try {
          ctx.openNote?.('notes/alpha.md');
        } catch (err) {
          error = err;
        }
      },
    };
    registry.register(plugin);
    await host.activate('open-note.demo');
    expect(error).toBeInstanceOf(PluginPermissionError);
    expect(openNote).not.toHaveBeenCalled();
  });

  it('refuses the operation when the host cannot open notes', async () => {
    const { registry, host } = makeHost();
    let error: unknown = null;
    const plugin: Plugin = {
      manifest: manifest(),
      activate(ctx): void {
        try {
          ctx.openNote?.('notes/alpha.md');
        } catch (err) {
          error = err;
        }
      },
    };
    registry.register(plugin);
    await host.activate('open-note.demo');
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('cannot open notes');
  });
});

describe('the backlinks of the plugin', () => {
  /** A store with one backlink and one mention without a link. */
  function storeWith(): BacklinksStore {
    const store = new BacklinksStore();
    store.set({
      available: true,
      ready: true,
      error: null,
      notePath: 'notes/alpha.md',
      backlinks: [{ name: 'beta', path: 'notes/beta.md', ambiguous: false }],
      unlinked: [{ name: 'gamma', path: 'notes/gamma.md', ambiguous: false }],
    });
    return store;
  }

  it('opens the note of a backlink when it is pressed', () => {
    const onOpen = vi.fn();
    render(<BacklinksView store={storeWith()} onOpen={onOpen} />);
    const buttons = document.querySelectorAll('.noto-backlinks-link');
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0] as Element);
    expect(onOpen).toHaveBeenCalledWith('notes/beta.md');
  });

  it('says that the note must be opened manually when the host has no operation', () => {
    render(<BacklinksView store={storeWith()} />);
    expect(screen.getByText(/open it manually/i)).toBeTruthy();
  });

  it('does not say it when the operation is available', () => {
    render(<BacklinksView store={storeWith()} onOpen={() => undefined} />);
    expect(screen.queryByText(/open it manually/i)).toBeNull();
  });
});
