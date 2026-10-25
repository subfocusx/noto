// The sandbox of the plugins (API 1.3.0).
//
// A plugin whose manifest declares `sandbox: true` does not run in the
// context of the application: its code runs inside an iframe with a strict
// Content-Security-Policy and talks to the host through a narrow, validated
// bridge (`postMessage`).
//
// The properties of the sandbox:
//
//   * the frame has the attribute `sandbox="allow-scripts"` and NO
//     `allow-same-origin`: the document of the plugin has an opaque origin,
//     so it cannot reach the DOM, the storage or the cookies of the
//     application;
//   * the document is served from a `srcdoc` with a strict policy
//     (`default-src 'none'`, a nonce for the scripts and the styles, no
//     network at all);
//   * the only way in and out is the bridge: every message is validated
//     (the channel, the id of the plugin, the method and the arguments), and
//     only the methods of the allow-list are answered.
//
// The module imports nothing from the application (rule R15): it is a
// mechanism, not a capability. The permissions of the plugin are enforced by
// the host, which builds the handlers of the bridge.
import { PLUGIN_API_VERSION } from './contract';

/** The channel of the messages of the bridge. */
export const SANDBOX_CHANNEL = 'noto-plugin-sandbox';

/**
 * The methods the bridge answers.
 *
 * The list is the whole surface of the sandbox: there is no other way for the
 * plugin to reach the host.
 */
export const SANDBOX_METHODS = [
  'api.getNote',
  'api.getTree',
  'api.search',
  'api.query',
  'api.tags',
  'editor.getText',
  'editor.getSelection',
  'editor.getCursor',
  'editor.getPath',
  'openNote',
  'log',
] as const;

/** A method of the bridge. */
export type SandboxMethod = (typeof SANDBOX_METHODS)[number];

/** A request of the plugin to the host. */
export interface SandboxRequest {
  channel: typeof SANDBOX_CHANNEL;
  pluginId: string;
  id: string;
  method: string;
  args?: unknown[];
}

/** The answer of the host to the plugin. */
export interface SandboxResponse {
  channel: typeof SANDBOX_CHANNEL;
  pluginId: string;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** True when the method is one of the allowed ones. */
export function isSandboxMethod(method: string): method is SandboxMethod {
  return (SANDBOX_METHODS as readonly string[]).includes(method);
}

/**
 * Validates an incoming message.
 *
 * Only the shape of the request is checked here: the channel, the id of the
 * plugin, the id of the request and the method. The method itself is checked
 * against the allow-list by the bridge.
 *
 * @returns the request, or `null` when the message is not a request.
 */
export function parseSandboxRequest(raw: unknown): SandboxRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Partial<SandboxRequest>;
  if (data.channel !== SANDBOX_CHANNEL) return null;
  if (typeof data.pluginId !== 'string' || data.pluginId.length === 0) return null;
  if (typeof data.id !== 'string' || data.id.length === 0) return null;
  if (typeof data.method !== 'string' || data.method.length === 0) return null;
  if (data.args !== undefined && !Array.isArray(data.args)) return null;
  return {
    channel: SANDBOX_CHANNEL,
    pluginId: data.pluginId,
    id: data.id,
    method: data.method,
    args: (data.args as unknown[] | undefined) ?? [],
  };
}

/** A handler of a method of the bridge. */
export type SandboxHandler = (args: unknown[]) => unknown;

/** The handlers of the bridge, by method. */
export type SandboxHandlers = Partial<Record<SandboxMethod, SandboxHandler>>;

/** Options of {@link SandboxBridge}. */
export interface SandboxBridgeOptions {
  /** The id of the plugin that owns the bridge. */
  pluginId: string;
  /** The handlers of the allowed methods. */
  handlers: SandboxHandlers;
  /** Called when a message is refused. */
  onRefuse?(message: string): void;
}

/**
 * The bridge between the host and the sandbox.
 *
 * The bridge answers a request only when the message belongs to the plugin
 * of the bridge and when the method is one of the allowed ones. Every other
 * message is refused with an error — never with a silent success.
 */
export class SandboxBridge {
  private readonly pluginId: string;
  private readonly handlers: SandboxHandlers;
  private readonly onRefuse: ((message: string) => void) | undefined;

  constructor(options: SandboxBridgeOptions) {
    this.pluginId = options.pluginId;
    this.handlers = options.handlers;
    this.onRefuse = options.onRefuse;
  }

  /**
   * Handles an incoming message.
   *
   * @returns the answer of the host, or `null` when the message is not a
   * request of the bridge at all (a message of another channel, for example).
   */
  async handle(raw: unknown): Promise<SandboxResponse | null> {
    const request = parseSandboxRequest(raw);
    if (!request) return null;
    if (request.pluginId !== this.pluginId) {
      this.refuse(`a message of the plugin "${request.pluginId}" was refused`);
      return this.error(request, 'the message belongs to another plugin');
    }
    if (!isSandboxMethod(request.method)) {
      this.refuse(`the method "${request.method}" is not allowed`);
      return this.error(request, `the method "${request.method}" is not allowed`);
    }
    const handler = this.handlers[request.method];
    if (!handler) {
      this.refuse(`the method "${request.method}" is not implemented`);
      return this.error(request, `the method "${request.method}" is not available`);
    }
    try {
      const result = await handler(request.args ?? []);
      return {
        channel: SANDBOX_CHANNEL,
        pluginId: this.pluginId,
        id: request.id,
        ok: true,
        result: result === undefined ? null : result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        channel: SANDBOX_CHANNEL,
        pluginId: this.pluginId,
        id: request.id,
        ok: false,
        error: message,
      };
    }
  }

  private error(request: SandboxRequest, message: string): SandboxResponse {
    return {
      channel: SANDBOX_CHANNEL,
      pluginId: this.pluginId,
      id: request.id,
      ok: false,
      error: message,
    };
  }

  private refuse(message: string): void {
    this.onRefuse?.(message);
  }
}

/**
 * Generates a nonce for the policy of the sandbox.
 *
 * The nonce is random for every frame: a script of the application cannot
 * guess it and cannot inject itself into the frame.
 */
export function createSandboxNonce(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** The policy of the sandbox: nothing is allowed but the scripts of the nonce. */
export function sandboxContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    'img-src data:',
    "connect-src 'none'",
    "font-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * The bootstrap of the sandbox: the bridge seen from inside the frame.
 *
 * The plugin of the sandbox uses `window.notoPlugin` and nothing else. The
 * bootstrap is a plain script (no `eval`, no `new Function`, no dynamic
 * import) and it is delivered with the nonce of the policy.
 */
const BOOTSTRAP_SOURCE = `
(function () {
  var CHANNEL = '__CHANNEL__';
  var PLUGIN_ID = __PLUGIN_ID__;
  var pending = {};
  var counter = 0;

  function send(method, args) {
    return new Promise(function (resolve, reject) {
      counter += 1;
      var id = 'r' + counter;
      pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage(
        { channel: CHANNEL, pluginId: PLUGIN_ID, id: id, method: method, args: args || [] },
        '*',
      );
    });
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.channel !== CHANNEL || data.pluginId !== PLUGIN_ID) return;
    var entry = pending[data.id];
    if (!entry) return;
    delete pending[data.id];
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(data.error || 'the host refused the request'));
  });

  window.notoPlugin = {
    pluginId: PLUGIN_ID,
    apiVersion: __API_VERSION__,
    api: {
      getNote: function (path) { return send('api.getNote', [path]); },
      getTree: function () { return send('api.getTree', []); },
      search: function (query, limit) { return send('api.search', [query, limit]); },
      query: function (query, limit) { return send('api.query', [query, limit]); },
      tags: function () { return send('api.tags', []); },
    },
    editor: {
      getText: function () { return send('editor.getText', []); },
      getSelection: function () { return send('editor.getSelection', []); },
      getCursor: function () { return send('editor.getCursor', []); },
      getPath: function () { return send('editor.getPath', []); },
    },
    openNote: function (path) { return send('openNote', [path]); },
    logger: {
      info: function (message) { return send('log', [String(message)]); },
      warn: function (message) { return send('log', [String(message)]); },
    },
  };
})();
`;

/**
 * Builds the document of the sandbox.
 *
 * The document is a `srcdoc`: the code of the plugin is delivered with the
 * nonce of the policy, so the policy can stay strict (there is no
 * `unsafe-inline` and no `unsafe-eval`).
 */
export function buildSandboxDocument(source: string, nonce: string, pluginId: string): string {
  const bootstrap = BOOTSTRAP_SOURCE.replace('__CHANNEL__', SANDBOX_CHANNEL)
    .replace('__PLUGIN_ID__', JSON.stringify(pluginId))
    .replace('__API_VERSION__', JSON.stringify(PLUGIN_API_VERSION));
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    `<meta http-equiv="Content-Security-Policy" content="${sandboxContentSecurityPolicy(nonce)}">`,
    `<style nonce="${nonce}">html,body{margin:0;padding:0;font:13px system-ui,sans-serif;color:#e4e1e6;background:transparent}.sandbox-title{margin:0 0 4px;font-weight:600}.sandbox-count{margin:0;color:#908f9e}</style>`,
    '</head>',
    '<body>',
    '<div id="root"></div>',
    `<script nonce="${nonce}">${bootstrap}</script>`,
    `<script nonce="${nonce}">${source}</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

/** Options of {@link PluginSandbox}. */
export interface PluginSandboxOptions {
  /** The id of the plugin that runs in the sandbox. */
  pluginId: string;
  /** The source of the plugin. */
  source: string;
  /** The handlers of the bridge. */
  handlers: SandboxHandlers;
  /** Called when a message of the frame is refused. */
  onRefuse?(message: string): void;
}

/**
 * A running sandbox: the frame of a plugin and the bridge that answers it.
 */
export class PluginSandbox {
  /** The frame of the sandbox. */
  readonly element: HTMLIFrameElement;
  /** The bridge of the sandbox. */
  readonly bridge: SandboxBridge;
  private readonly nonce: string;
  private disposed = false;

  constructor(options: PluginSandboxOptions) {
    this.nonce = createSandboxNonce();
    this.bridge = new SandboxBridge({
      pluginId: options.pluginId,
      handlers: options.handlers,
      onRefuse: options.onRefuse,
    });
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', `The sandbox of the plugin ${options.pluginId}`);
    frame.setAttribute('data-plugin-sandbox', options.pluginId);
    frame.srcdoc = buildSandboxDocument(options.source, this.nonce, options.pluginId);
    this.element = frame;
    window.addEventListener('message', this.onMessage);
  }

  /** Attaches the frame to a container of the interface. */
  attach(container: HTMLElement): void {
    container.appendChild(this.element);
  }

  /** Removes the frame and stops the bridge. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('message', this.onMessage);
    this.element.remove();
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (this.disposed) return;
    // Only the frame of this sandbox may talk to the bridge.
    if (event.source !== this.element.contentWindow) return;
    void this.bridge.handle(event.data).then((response) => {
      if (!response || this.disposed) return;
      this.element.contentWindow?.postMessage(response, '*');
    });
  };
}
