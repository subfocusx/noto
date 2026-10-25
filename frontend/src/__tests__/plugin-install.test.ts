// The installation of the plugins from the disk and from the network
// (API 1.3.0).
//
// A plugin can be installed from a file that the user picked and from a URL.
// The manifest is validated exactly like the manifest of a built-in plugin,
// and the integrity of the manifest of a URL is checked against the expected
// hash. The registry lists the installed plugins with their origin.
//
// The code of an installed plugin is NOT executed: Noto never runs the code
// that comes from the disk or from the network.
import { describe, expect, it, vi } from 'vitest';
import {
  installPluginFromFile,
  installPluginFromUrl,
  parsePluginManifest,
  registerInstalledPlugin,
} from '../plugins/loader';
import { PluginRegistry } from '../plugins/registry';

/** A manifest of a plugin, as a JSON text. */
function manifestJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'installed.demo',
    name: 'Installed demo',
    version: '1.0.0',
    manifestVersion: 1,
    minApiVersion: '1.0.0',
    permissions: ['notes.read'],
    ...overrides,
  });
}

/** A digest that is not a real SHA-256, but is deterministic. */
async function fakeDigest(text: string): Promise<string> {
  return `fake-${text.length}-${text.slice(0, 4)}`;
}

describe('the installation of a plugin from a file', () => {
  it('reads the manifest of the file and validates it', async () => {
    const file = new File([manifestJson()], 'demo.json', { type: 'application/json' });
    const installed = await installPluginFromFile(file);
    expect(installed.manifest.id).toBe('installed.demo');
    expect(installed.manifest.name).toBe('Installed demo');
    expect(installed.source).toEqual({ kind: 'file', location: 'demo.json' });
  });

  it('refuses a manifest that is not valid JSON', async () => {
    const file = new File(['not json'], 'broken.json');
    await expect(installPluginFromFile(file)).rejects.toThrow(/not valid JSON/);
  });

  it('refuses a manifest that is invalid', async () => {
    const file = new File([manifestJson({ id: 'Bad Id!' })], 'broken.json');
    await expect(installPluginFromFile(file)).rejects.toThrow(/invalid/);
  });

  it('computes the integrity of the manifest when a digest is given', async () => {
    const text = manifestJson();
    const file = new File([text], 'demo.json');
    const installed = await installPluginFromFile(file, { digest: fakeDigest });
    expect(installed.source.integrity).toBe(await fakeDigest(text));
  });
});

describe('the installation of a plugin from a URL', () => {
  it('fetches the manifest and validates it', async () => {
    const fetchImpl = vi.fn(async () => new Response(manifestJson(), { status: 200 }));
    const installed = await installPluginFromUrl('https://example.test/demo.json', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(installed.manifest.id).toBe('installed.demo');
    expect(installed.source.kind).toBe('url');
    expect(installed.source.location).toBe('https://example.test/demo.json');
  });

  it('refuses an answer that is not successful', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(
      installPluginFromUrl('https://example.test/demo.json', { fetchImpl }),
    ).rejects.toThrow(/cannot be fetched/);
  });

  it('refuses a manifest whose integrity does not match', async () => {
    const fetchImpl = vi.fn(async () => new Response(manifestJson(), { status: 200 }));
    await expect(
      installPluginFromUrl('https://example.test/demo.json', {
        fetchImpl,
        digest: fakeDigest,
        expectedSha256: 'something-else',
      }),
    ).rejects.toThrow(/integrity/);
  });

  it('accepts a manifest whose integrity matches', async () => {
    const text = manifestJson();
    const fetchImpl = vi.fn(async () => new Response(text, { status: 200 }));
    const installed = await installPluginFromUrl('https://example.test/demo.json', {
      fetchImpl,
      digest: fakeDigest,
      expectedSha256: await fakeDigest(text),
    });
    expect(installed.source.integrity).toBe(await fakeDigest(text));
  });

  it('reads the expected hash from the fragment of the URL', async () => {
    const text = manifestJson();
    const fetchImpl = vi.fn(async () => new Response(text, { status: 200 }));
    const installed = await installPluginFromUrl(
      `https://example.test/demo.json#sha256=${await fakeDigest(text)}`,
      { fetchImpl, digest: fakeDigest },
    );
    expect(installed.source.integrity).toBe(await fakeDigest(text));
  });
});

describe('the registry of the installed plugins', () => {
  it('lists the installed plugin with its origin', async () => {
    const registry = new PluginRegistry();
    const file = new File([manifestJson()], 'demo.json');
    const installed = await installPluginFromFile(file);
    const result = registerInstalledPlugin(registry, installed);
    expect(result.ok).toBe(true);

    const entry = registry.get('installed.demo');
    expect(entry).toBeDefined();
    expect(entry?.source).toEqual({ kind: 'file', location: 'demo.json' });
    expect(entry?.state).toBe('discovered');
  });

  it('lists a plugin of a URL with its origin', async () => {
    const registry = new PluginRegistry();
    const fetchImpl = vi.fn(async () => new Response(manifestJson(), { status: 200 }));
    const installed = await installPluginFromUrl('https://example.test/demo.json', { fetchImpl });
    registerInstalledPlugin(registry, installed);
    const entry = registry.get('installed.demo');
    expect(entry?.source?.kind).toBe('url');
  });
});

describe('the parser of the manifests', () => {
  it('returns the manifest of a valid text', () => {
    const manifest = parsePluginManifest(manifestJson());
    expect(manifest.id).toBe('installed.demo');
  });

  it('names every problem of an invalid manifest', () => {
    let message = '';
    try {
      parsePluginManifest(manifestJson({ id: 'X', version: '1' }));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('invalid');
    expect(message).toContain('id must match');
    expect(message).toContain('version must be');
  });
});
