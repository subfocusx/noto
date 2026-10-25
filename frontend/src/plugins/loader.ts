// Static list of built-in plugins.
//
// Built-in plugins are compiled into the application: there is no dynamic
// `import()`, no `import.meta.glob`, no remote code loading and no `eval`.
// Plugin ids and display strings are never used as a module specifier.
//
// The list is static on purpose: it is the only way to ship plugins without
// introducing an arbitrary code execution path into the application.
import type { Plugin, PluginManifest } from './contract';
import { validateManifest } from './manifest';
import type { PluginRegistry, PluginSource } from './registry';
import { insertTemplatePlugin } from './builtin/insert-template';
import { wordCountPlugin } from './builtin/word-count';
import { backlinksPlugin } from './builtin/backlinks';
import { graphPlugin } from './builtin/graph';
import { tagsPlugin } from './builtin/tags';
import { activityPlugin } from './builtin/activity';
import { linksPlugin } from './builtin/links';
import { sandboxDemoPlugin } from './builtin/sandbox-demo';

/**
 * The built-in plugins known to this build.
 *
 * Each entry is a static object literal created by the integration layer.
 * The order defines the order in the plugin manager panel.
 */
export const builtinPlugins: Plugin[] = [
  wordCountPlugin,
  insertTemplatePlugin,
  backlinksPlugin,
  graphPlugin,
  tagsPlugin,
  activityPlugin,
  linksPlugin,
  sandboxDemoPlugin,
];

/* --------------------------------------------------------------- installing */

/**
 * A plugin that the user installed.
 *
 * The manifest of an installed plugin is validated exactly like the manifest
 * of a built-in plugin. The code of an installed plugin is NOT executed by
 * this build: Noto never runs the code that comes from the disk or from the
 * network (see `docs/PLUGIN_SECURITY.md`). The plugin is listed in the
 * manager with its origin, so the user sees what is installed.
 */
export interface InstalledPlugin {
  /** The plugin of the manifest (it only logs that it is installed). */
  plugin: Plugin;
  /** The validated manifest. */
  manifest: PluginManifest;
  /** Where the plugin comes from. */
  source: PluginSource;
}

/** Options of the installation of a plugin. */
export interface PluginInstallOptions {
  /** The function that fetches a manifest from a URL (the tests mock it). */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /**
   * The digest of the manifest (the SHA-256 in hex).
   *
   * The default uses the Web Crypto of the browser; the tests inject their
   * own digest.
   */
  digest?: (text: string) => Promise<string>;
}

/**
 * The SHA-256 of a text, in hex.
 *
 * @throws when the environment has no Web Crypto (the tests inject their own
 * digest in that case).
 */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) {
    throw new Error('no digest is available in this environment');
  }
  const bytes = new TextEncoder().encode(text);
  const hash = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Reads the text of a file the user picked. */
async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('the file cannot be read'));
    reader.readAsText(file);
  });
}

/**
 * Parses and validates the manifest of a plugin.
 *
 * @throws {Error} when the text is not JSON or when the manifest is invalid.
 */
export function parsePluginManifest(text: string): PluginManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`the manifest is not valid JSON: ${message}`);
  }
  const validation = validateManifest(raw);
  if (!validation.ok) {
    throw new Error(`the manifest of the plugin is invalid: ${validation.errors.join('; ')}`);
  }
  return raw as PluginManifest;
}

/** Creates the plugin of an installed manifest (its code is never executed). */
function createInstalledPlugin(manifest: PluginManifest): Plugin {
  return {
    manifest,
    activate(ctx): void {
      ctx.logger.warn('the plugin is installed, but this build does not run the code of an installed plugin');
    },
  };
}

/**
 * Installs a plugin from a file of the disk.
 *
 * The file must contain the manifest of the plugin (JSON). The manifest is
 * validated exactly like the manifest of a built-in plugin; an invalid
 * manifest is refused with an error that names every problem.
 */
export async function installPluginFromFile(
  file: File,
  options: PluginInstallOptions = {},
): Promise<InstalledPlugin> {
  const text = await readFileText(file);
  const manifest = parsePluginManifest(text);
  const source: PluginSource = { kind: 'file', location: file.name };
  if (options.digest) {
    source.integrity = await options.digest(text);
  }
  return { plugin: createInstalledPlugin(manifest), manifest, source };
}

/**
 * Installs a plugin from a URL.
 *
 * The manifest is fetched, parsed and validated. When the caller gives the
 * expected SHA-256 (or the URL carries it in the fragment
 * `#sha256=<hex>`), the integrity of the manifest is checked: a mismatch is
 * refused with an error.
 */
export async function installPluginFromUrl(
  url: string,
  options: PluginInstallOptions & { expectedSha256?: string } = {},
): Promise<InstalledPlugin> {
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`the manifest cannot be fetched: ${response.status}`);
  }
  const text = await response.text();
  const manifest = parsePluginManifest(text);

  const expected = options.expectedSha256 ?? readExpectedHash(url);
  let integrity: string | undefined;
  if (expected) {
    const digest = options.digest ?? sha256Hex;
    integrity = await digest(text);
    if (integrity.toLowerCase() !== expected.toLowerCase()) {
      throw new Error('the integrity of the manifest does not match the expected hash');
    }
  } else if (options.digest) {
    integrity = await options.digest(text);
  }

  const source: PluginSource = { kind: 'url', location: url };
  if (integrity) source.integrity = integrity;
  return { plugin: createInstalledPlugin(manifest), manifest, source };
}

/** Reads the expected hash of the fragment of a URL (`#sha256=<hex>`). */
function readExpectedHash(url: string): string | undefined {
  const index = url.indexOf('#sha256=');
  if (index < 0) return undefined;
  const hash = url.slice(index + '#sha256='.length).trim();
  return hash.length > 0 ? hash : undefined;
}

/**
 * Registers an installed plugin in the registry.
 *
 * The registry keeps the origin of the plugin, so the manager can show where
 * the plugin comes from.
 */
export function registerInstalledPlugin(
  registry: PluginRegistry,
  installed: InstalledPlugin,
): { ok: boolean; error?: string } {
  return registry.register(installed.plugin, installed.source);
}
