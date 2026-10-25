// The "Sandbox demo" built-in plugin.
//
// The plugin shows how a plugin runs inside the sandbox of the platform
// (API 1.3.0): its code does NOT run in the context of the application. The
// code lives in the string `sandboxDemoSource`, it is delivered to an iframe
// with a strict Content-Security-Policy and it talks to the host through the
// bridge of the sandbox (`window.notoPlugin`).
//
// The plugin imports nothing but the contract (rules R3 and R13): the source
// of the frame is a string, so there is nothing to import.
import type { Plugin, PluginManifest } from '../../contract';

/** Id of the panel contributed by the plugin. */
export const SANDBOX_DEMO_PANEL_ID = 'sandbox-demo.panel';

/** Static description of the plugin. */
export const sandboxDemoManifest: PluginManifest = {
  id: 'sandbox-demo',
  name: 'Sandbox demo',
  version: '1.0.0',
  manifestVersion: 1,
  minApiVersion: '1.3.0',
  description: 'A plugin that runs inside the sandbox of the plugins.',
  author: 'Noto',
  // `tree.read` — the list of the notes (`api.getTree`).
  permissions: ['tree.read'],
  // The plugin asks for the sandbox: its code runs inside an iframe.
  sandbox: true,
};

/**
 * The source of the plugin, as it runs inside the frame.
 *
 * The source uses only the bridge of the sandbox. It has no `eval`, no
 * `new Function`, no dynamic import and no network access — the policy of the
 * frame forbids the network anyway (`connect-src 'none'`).
 */
export const sandboxDemoSource = `
(async function () {
  var root = document.getElementById('root');
  try {
    var tree = await window.notoPlugin.api.getTree();
    var files = (tree && tree.files) || [];
    var folders = (tree && tree.folders) || [];
    root.textContent = '';
    var title = document.createElement('p');
    title.className = 'sandbox-title';
    title.textContent = 'The plugin runs inside the sandbox.';
    var count = document.createElement('p');
    count.className = 'sandbox-count';
    count.textContent = 'Notes: ' + files.length + ', folders: ' + folders.length;
    root.appendChild(title);
    root.appendChild(count);
    window.notoPlugin.logger.info('the sandbox counted the notes of the vault');
  } catch (err) {
    root.textContent = 'The sandbox failed: ' + (err && err.message ? err.message : err);
  }
})();
`;

/** The plugin of the sandbox. */
export const sandboxDemoPlugin: Plugin = {
  manifest: sandboxDemoManifest,
  sandboxSource: sandboxDemoSource,
  /**
   * The activation in the context of the application.
   *
   * The host never calls it for a sandboxed plugin: the code of the plugin
   * runs inside the frame. The method exists only to satisfy the contract.
   */
  activate(): void {
    // Nothing to do: the plugin runs inside the sandbox.
  },
};
