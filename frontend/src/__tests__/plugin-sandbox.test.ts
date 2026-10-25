// The sandbox of the plugins (API 1.3.0).
//
// A plugin whose manifest declares `sandbox: true` runs inside an iframe with
// a strict Content-Security-Policy and talks to the host through a narrow,
// validated bridge. The tests below check:
//
//   * the validation of the messages of the bridge (the channel, the plugin,
//     the method);
//   * the strictness of the policy of the frame;
//   * the activation of a sandboxed plugin by the host;
//   * the new boundary rule R17 (the source of a sandboxed plugin may not
//     evaluate code and may not use the network).
import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { render } from '@testing-library/preact';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  SANDBOX_CHANNEL,
  SandboxBridge,
  buildSandboxDocument,
  createSandboxNonce,
  isSandboxMethod,
  parseSandboxRequest,
  sandboxContentSecurityPolicy,
} from '../plugins/sandbox';
import { PluginHost } from '../plugins/host';
import { PluginRegistry } from '../plugins/registry';
import { EventBus } from '../core/events/eventBus';
import { CommandRegistry } from '../core/commands/commandRegistry';
import { SettingsStore } from '../core/settings/settingsStore';
import { createPluginApi } from '../core/api/pluginApi';
import { sandboxDemoManifest, sandboxDemoPlugin, sandboxDemoSource } from '../plugins/builtin/sandbox-demo/index';
import type { Plugin } from '../plugins/contract';

const FRONTEND_ROOT = resolve(__dirname, '..', '..');
const CHECKER = join(FRONTEND_ROOT, 'scripts', 'check-boundaries.mjs');

/** A request of the bridge. */
function request(method: string, args: unknown[] = [], pluginId = 'sandbox.demo'): unknown {
  return {
    channel: SANDBOX_CHANNEL,
    pluginId,
    id: 'r1',
    method,
    args,
  };
}

describe('the validation of the messages of the bridge', () => {
  it('accepts a message of the channel', () => {
    const parsed = parseSandboxRequest(request('api.getTree'));
    expect(parsed).not.toBeNull();
    expect(parsed?.method).toBe('api.getTree');
    expect(parsed?.args).toEqual([]);
  });

  it('refuses a message of another channel', () => {
    expect(parseSandboxRequest({ ...(request('api.getTree') as object), channel: 'other' })).toBeNull();
  });

  it('refuses a message that is not an object', () => {
    expect(parseSandboxRequest('hello')).toBeNull();
    expect(parseSandboxRequest(null)).toBeNull();
  });

  it('refuses a message without an id or without a method', () => {
    expect(parseSandboxRequest({ channel: SANDBOX_CHANNEL, pluginId: 'a', method: 'api.getTree' })).toBeNull();
    expect(parseSandboxRequest({ channel: SANDBOX_CHANNEL, pluginId: 'a', id: 'r1' })).toBeNull();
  });

  it('knows the methods of the bridge', () => {
    expect(isSandboxMethod('api.getNote')).toBe(true);
    expect(isSandboxMethod('eval')).toBe(false);
  });
});

describe('the bridge of the sandbox', () => {
  it('answers a method of the allow-list', async () => {
    const bridge = new SandboxBridge({
      pluginId: 'sandbox.demo',
      handlers: {
        'api.getTree': () => ({ folders: [], files: [{ path: 'a.md' }] }),
      },
    });
    const answer = await bridge.handle(request('api.getTree'));
    expect(answer?.ok).toBe(true);
    expect(answer?.result).toEqual({ folders: [], files: [{ path: 'a.md' }] });
  });

  it('refuses a method that is not in the allow-list', async () => {
    const bridge = new SandboxBridge({
      pluginId: 'sandbox.demo',
      handlers: {},
    });
    const answer = await bridge.handle(request('window.__proto__'));
    expect(answer?.ok).toBe(false);
    expect(answer?.error).toContain('not allowed');
  });

  it('refuses a message of another plugin', async () => {
    const onRefuse = vi.fn();
    const bridge = new SandboxBridge({
      pluginId: 'sandbox.demo',
      handlers: { 'api.getTree': () => null },
      onRefuse,
    });
    const answer = await bridge.handle(request('api.getTree', [], 'another.plugin'));
    expect(answer?.ok).toBe(false);
    expect(onRefuse).toHaveBeenCalled();
  });

  it('ignores a message that is not a request', async () => {
    const bridge = new SandboxBridge({ pluginId: 'sandbox.demo', handlers: {} });
    expect(await bridge.handle('hello')).toBeNull();
  });

  it('turns the error of a handler into the answer', async () => {
    const bridge = new SandboxBridge({
      pluginId: 'sandbox.demo',
      handlers: {
        'api.getNote': () => {
          throw new Error('the note cannot be read');
        },
      },
    });
    const answer = await bridge.handle(request('api.getNote', ['a.md']));
    expect(answer?.ok).toBe(false);
    expect(answer?.error).toContain('cannot be read');
  });
});

describe('the policy of the sandbox', () => {
  it('forbids everything but the scripts of the nonce', () => {
    const policy = sandboxContentSecurityPolicy('abc123');
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'nonce-abc123'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('generates a nonce that changes every time', () => {
    expect(createSandboxNonce()).not.toBe(createSandboxNonce());
  });

  it('delivers the source of the plugin with the nonce', () => {
    const document_ = buildSandboxDocument('window.x = 1;', 'nonce42', 'sandbox.demo');
    expect(document_).toContain('Content-Security-Policy');
    expect(document_).toContain("script-src 'nonce-nonce42'");
    expect(document_).toContain('window.x = 1;');
    // The frame has no origin of its own: the document is served with the
    // attribute `sandbox` and without `allow-same-origin`.
    expect(document_).toContain('sandbox');
  });
});

describe('the activation of a sandboxed plugin', () => {
  it('runs the plugin in a frame and registers a panel for it', async () => {
    const registry = new PluginRegistry();
    const host = new PluginHost({
      registry,
      bus: new EventBus(),
      commands: new CommandRegistry(),
      settings: new SettingsStore(),
      createApi: () => createPluginApi(),
      getEditor: () => null,
    });
    registry.register(sandboxDemoPlugin);
    registry.enable('sandbox-demo');
    await host.activate('sandbox-demo');

    expect(registry.get('sandbox-demo')?.state).toBe('active');
    // The panel mounts the frame of the sandbox.
    const panels = host.panels();
    expect(panels).toHaveLength(1);
    render(panels[0]?.render() as never);

    const frame = document.querySelector('iframe[data-plugin-sandbox="sandbox-demo"]');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame?.getAttribute('srcdoc') ?? '').toContain("default-src 'none'");
  });

  it('refuses a sandboxed plugin without a source', async () => {
    const registry = new PluginRegistry();
    const host = new PluginHost({
      registry,
      bus: new EventBus(),
      commands: new CommandRegistry(),
      settings: new SettingsStore(),
      createApi: () => createPluginApi(),
      getEditor: () => null,
    });
    const plugin: Plugin = {
      manifest: { ...sandboxDemoManifest, id: 'sandbox.empty' },
      activate: () => undefined,
    };
    registry.register(plugin);
    registry.enable('sandbox.empty');
    await host.activate('sandbox.empty');
    expect(registry.get('sandbox.empty')?.state).toBe('failed');
  });

  it('ships a source without the evaluation of the code and without the network', () => {
    expect(sandboxDemoSource).not.toMatch(/eval\s*\(/);
    expect(sandboxDemoSource).not.toMatch(/new\s+Function/);
    expect(sandboxDemoSource).not.toMatch(/\bimport\s*\(/);
    expect(sandboxDemoSource).not.toMatch(/fetch\s*\(/);
    expect(sandboxDemoSource).not.toMatch(/XMLHttpRequest/);
  });
});

describe('the new boundary rule of the sandbox', () => {
  /**
   * Runs the checker on a fixture tree.
   */
  function runChecker(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'noto-sandbox-'));
    mkdirSync(join(root, 'src', 'plugins', 'builtin', 'demo'), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const target = join(root, name);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
    try {
      return execFileSync('node', [CHECKER, '--root', root], { encoding: 'utf8' });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    }
  }

  it('refuses a sandboxed plugin whose source evaluates the code (R17)', () => {
    const output = runChecker({
      'src/plugins/builtin/demo/index.ts':
        "export const sandboxSource = 'eval(source)';\nexport const x = 1;\n",
      'src/plugins/contract.ts': 'export const x = 1;\n',
    });
    expect(output).toContain('R17');
  });

  it('refuses a sandboxed plugin whose source uses the network (R17)', () => {
    const output = runChecker({
      'src/plugins/builtin/demo/index.ts':
        "export const sandboxSource = 'fetch(url)';\nexport const x = 1;\n",
      'src/plugins/contract.ts': 'export const x = 1;\n',
    });
    expect(output).toContain('R17');
  });

  it('accepts a sandboxed plugin whose source is clean (R17)', () => {
    const output = runChecker({
      'src/plugins/builtin/demo/index.ts':
        "export const sandboxSource = 'window.notoPlugin.api.getTree()';\nexport const x = 1;\n",
      'src/plugins/contract.ts': 'export const x = 1;\n',
    });
    expect(output).not.toContain('R17');
  });
});
