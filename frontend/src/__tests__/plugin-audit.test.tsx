// The audit log of the actions of the plugins (API 1.3.0).
//
// Every action of a plugin (open, read, write, command) is recorded with the
// id of the plugin, the action, the moment and the target. The log is a
// bounded ring buffer and the panel of the plugins shows it.
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/preact';
import { PluginAuditLog, PLUGIN_AUDIT_CAPACITY } from '../plugins/audit';
import { PluginHost } from '../plugins/host';
import { PluginRegistry } from '../plugins/registry';
import { EventBus } from '../core/events/eventBus';
import { CommandRegistry } from '../core/commands/commandRegistry';
import { SettingsStore } from '../core/settings/settingsStore';
import { createPluginApi } from '../core/api/pluginApi';
import { PluginManagerPanel } from '../components/PluginManagerPanel';
import type { Plugin, PluginManifest } from '../plugins/contract';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'audit.demo',
    name: 'Audit demo',
    version: '1.0.0',
    manifestVersion: 1,
    minApiVersion: '1.3.0',
    permissions: ['notes.read', 'notes.write', 'ui.contribute'],
    ...overrides,
  };
}

describe('the ring buffer of the audit log', () => {
  it('records the plugin, the action, the moment and the target', () => {
    const log = new PluginAuditLog();
    const entry = log.record('word-count', 'read', 'notes/alpha.md', '2026-01-02T03:04:05.000Z');
    expect(entry).toEqual({
      pluginId: 'word-count',
      action: 'read',
      at: '2026-01-02T03:04:05.000Z',
      target: 'notes/alpha.md',
    });
    expect(log.entries()).toHaveLength(1);
  });

  it('shows the newest record first', () => {
    const log = new PluginAuditLog();
    log.record('a', 'read', 'one.md');
    log.record('b', 'write', 'two.md');
    expect(log.entries().map((entry) => entry.target)).toEqual(['two.md', 'one.md']);
  });

  it('keeps only the last records when it is full', () => {
    const log = new PluginAuditLog(PLUGIN_AUDIT_CAPACITY);
    for (let i = 0; i < PLUGIN_AUDIT_CAPACITY + 25; i += 1) {
      log.record('demo', 'read', `note-${i}.md`);
    }
    expect(log.size).toBe(PLUGIN_AUDIT_CAPACITY);
    const entries = log.entries();
    expect(entries).toHaveLength(PLUGIN_AUDIT_CAPACITY);
    expect(entries[0]?.target).toBe(`note-${PLUGIN_AUDIT_CAPACITY + 24}.md`);
    expect(entries[entries.length - 1]?.target).toBe('note-25.md');
  });

  it('notifies the subscribers and can be cleared', () => {
    const log = new PluginAuditLog();
    const seen: string[] = [];
    const off = log.subscribe((entry) => seen.push(entry.target));
    log.record('demo', 'read', 'a.md');
    off();
    log.record('demo', 'read', 'b.md');
    expect(seen).toEqual(['a.md']);
    log.clear();
    expect(log.entries()).toEqual([]);
  });
});

describe('the audit log of the host', () => {
  /** Builds a host with an audit log. */
  function makeHost() {
    const registry = new PluginRegistry();
    const audit = new PluginAuditLog();
    const host = new PluginHost({
      registry,
      bus: new EventBus(),
      commands: new CommandRegistry(),
      settings: new SettingsStore(),
      createApi: () =>
        createPluginApi({
          getNote: async (path) => ({
            path,
            content: '# hello',
            revision: 1,
            updatedAt: '2026-01-01T00:00:00Z',
            conflict: false,
          }),
          saveNote: async (path) => ({
            path,
            revision: 2,
            updatedAt: '2026-01-01T00:00:00Z',
          }),
        }),
      getEditor: () => null,
      openNote: () => undefined,      audit,
    });
    return { registry, host, audit };
  }

  it('records a read, a write, an open and a command', async () => {
    const { registry, host } = makeHost();
    const plugin: Plugin = {
      manifest: manifest(),
      async activate(ctx): Promise<void> {
        await ctx.api.getNote('notes/alpha.md');
        await ctx.api.saveNote('notes/alpha.md', '# hello', 1);
        ctx.openNote?.('notes/beta.md');
        ctx.registerCommand({
          id: 'audit.demo.run',
          title: 'Run',
          run: () => undefined,
        });
        await host.runCommand('audit.demo.run');
      },
    };
    registry.register(plugin);
    await host.activate('audit.demo');

    const actions = host.auditEntries().map((entry) => entry.action);
    expect(actions).toContain('read');
    expect(actions).toContain('write');
    expect(actions).toContain('open');
    expect(actions).toContain('command');

    const read = host.auditEntries().find((entry) => entry.action === 'read');
    expect(read?.target).toBe('notes/alpha.md');
    const write = host.auditEntries().find((entry) => entry.action === 'write');
    expect(write?.target).toBe('notes/alpha.md');
    const open = host.auditEntries().find((entry) => entry.action === 'open');
    expect(open?.target).toBe('notes/beta.md');
    const command = host.auditEntries().find((entry) => entry.action === 'command');
    expect(command?.target).toBe('audit.demo.run');
    expect(host.auditEntries().every((entry) => entry.pluginId === 'audit.demo')).toBe(true);
  });
});

describe('the panel of the plugins', () => {
  it('shows the actions of the plugins', () => {
    render(
      <PluginManagerPanel
        plugins={[
          {
            id: 'audit.demo',
            manifest: manifest(),
            status: 'active',
          },
        ]}
        onEnable={() => undefined}
        onDisable={() => undefined}
        onOpenSettings={() => undefined}
        onResetSettings={() => undefined}
        audit={[
          {
            pluginId: 'audit.demo',
            action: 'open',
            at: '2026-01-02T03:04:05.000Z',
            target: 'notes/beta.md',
          },
        ]}
      />,
    );

    expect(screen.getByText('Actions of the plugins')).toBeTruthy();
    expect(screen.getByText('audit.demo')).toBeTruthy();
    expect(screen.getByText('notes/beta.md')).toBeTruthy();
    expect(document.querySelector('[data-plugin-audit-action="open"]')).not.toBeNull();
  });

  it('shows no section when there is no action', () => {
    render(
      <PluginManagerPanel
        plugins={[]}
        onEnable={() => undefined}
        onDisable={() => undefined}
        onOpenSettings={() => undefined}
        onResetSettings={() => undefined}
        audit={[]}
      />,
    );
    expect(screen.queryByText('Actions of the plugins')).toBeNull();
  });
});
