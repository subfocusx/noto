// The plugin host: activates plugins and owns everything they register.
//
// The host is the only place where plugin code runs. It builds a
// {@link PluginContext} that exposes exactly the capabilities listed in the
// contract — a plugin can never reach application internals.
//
// Permissions: the host enforces the permissions declared in the manifest of
// the plugin. Every capability handed to the plugin is wrapped in a
// restricted version that checks the permissions before the call. A plugin
// that tries to do something it did not ask for gets a
// {@link PluginPermissionError} — never a silent no-op.
//
// Failure policy: a plugin that throws during activation is put into the
// `failed` state with the error message; the error is never propagated to
// the caller, so the application keeps working. A permission error is not a
// broken plugin: the plugin stays active with the registrations it managed
// to make, and the reason is reported through the registry.
import type {
  Plugin,
  PluginApi,
  PluginAuditEntry,
  PluginCommand,
  PluginContext,
  PluginContextMenuItem,
  PluginEditor,
  PluginEventMap,
  PluginEventName,
  PluginLogger,
  PluginPanel,
  PluginPermission,
  PluginSettings,
  PluginSettingsSection,
  PluginSidebarItem,
  PluginToolbarItem,
} from './contract';
import { PLUGIN_API_VERSION } from './contract';
import { isCompatible } from './manifest';
import { PluginAuditLog } from './audit';
import { PluginSandbox, type SandboxHandlers } from './sandbox';
import type { PluginRegistry } from './registry';
import type { EventBus } from '../core/events/eventBus';
import type { CommandRegistry } from '../core/commands/commandRegistry';
import type { SettingsStore } from '../core/settings/settingsStore';
import { createLogger } from '../core/diagnostics/logger';
import {
  PluginPermissionError,
  freezeVaultState,
  requirePermission,
  restrictPluginApi,
  type PluginPermissionName,
  type PluginVaultStateLike,
} from '../core/api/pluginApi';
import { h } from 'preact';

/** Dependencies of the {@link PluginHost}. */
export interface PluginHostDeps {
  registry: PluginRegistry;
  bus: EventBus<PluginEventMap>;
  commands: CommandRegistry;
  settings: SettingsStore;
  createApi(pluginId: string): PluginApi;
  getEditor(): PluginEditor | null;
  /**
   * Optional push source of the editor of the application.
   *
   * When it is given, the host is notified about every change of the editor.
   * Without it the host polls `getEditor()` every time the editor is
   * requested, which detects the appearance, the disappearance and the
   * change of the note.
   */
  subscribeEditor?: (cb: (editor: PluginEditor | null) => void) => () => void;
  /**
   * Optional source of the state of the encrypted storage.
   *
   * The application may publish the state through this function; the host
   * hands a frozen copy to the plugins. When the function is missing (or
   * returns nothing), the plugins see no state at all.
   *
   * The state carries status information only — never key material.
   */
  getVaultState?: () => PluginVaultStateLike | undefined;
  /**
   * The operation that opens a note (API 1.3.0).
   *
   * The application gives the host the way to navigate to a note: the host
   * hands it to the plugins as `ctx.openNote(path)`. When the dependency is
   * missing, the operation is refused with an error — it is never a silent
   * no-op.
   */
  openNote?: (path: string) => void | Promise<void>;
  /**
   * The audit log of the actions of the plugins (API 1.3.0).
   *
   * The host creates its own log when the dependency is missing, so the log
   * always exists and the panel can show it.
   */
  audit?: PluginAuditLog;
  logger?: PluginLogger;
}

interface PluginRuntime {
  cleanups: Array<() => void>;
  deactivateCallbacks: Array<() => void>;
  /** Callbacks waiting for a new editor (see `ctx.onEditor`). */
  editorWatchers: Set<(editor: PluginEditor | null) => void>;
  /** Number of the live event subscriptions of the plugin. */
  eventSubscriptions: number;
  panels: Map<string, PluginPanel>;
  sidebarItems: Map<string, PluginSidebarItem>;
  contextMenuItems: Map<string, PluginContextMenuItem>;
  toolbarItems: Map<string, PluginToolbarItem>;
  settingsSections: Map<string, PluginSettingsSection>;
  /** The sandboxes of the plugins that run inside an iframe. */
  sandboxes: Map<string, PluginSandbox>;
}

/**
 * Wraps an editor with permission checks.
 *
 * The result is a NEW object: the plugin never gets a reference to the
 * unrestricted editor of the application.
 */
function restrictEditor(
  editor: PluginEditor,
  pluginId: string,
  permissions: readonly string[],
): PluginEditor {
  const need = (permission: PluginPermissionName): void => {
    requirePermission(pluginId, permissions, permission);
  };
  return {
    getText(): string {
      need('editor.read');
      return editor.getText();
    },
    getSelection(): string {
      need('editor.read');
      return editor.getSelection();
    },
    getCursor(): { from: number; to: number } {
      need('editor.read');
      return editor.getCursor();
    },
    insert(text: string): void {
      need('editor.write');
      editor.insert(text);
    },
    insertAt(text: string, from: number, to: number): void {
      need('editor.write');
      editor.insertAt(text, from, to);
    },
    replaceSelection(text: string): void {
      need('editor.write');
      editor.replaceSelection(text);
    },
    // Focusing the editor and opening the search do not read or change the
    // content of the note, so they need no permission.
    focus(): void {
      editor.focus();
    },
    openSearch(): void {
      editor.openSearch();
    },
    // The path is metadata, not content.
    getPath(): string | null {
      return editor.getPath();
    },
    onChange(cb: (text: string) => void): () => void {
      need('editor.read');
      return editor.onChange(cb);
    },
    onSelectionChange(cb: (sel: { from: number; to: number }) => void): () => void {
      need('editor.read');
      return editor.onSelectionChange(cb);
    },
  };
}

/**
 * Wraps the data API of a plugin with the audit log (API 1.3.0).
 *
 * The wrapper is a proxy: the shape of the API object stays exactly the same
 * (the hidden members `query`, `tags` and `vault` keep their place), but
 * every call is recorded in the log of the host.
 *
 * The log never carries the content of a note: only the path of the note, the
 * kind of the query and the id of the command.
 */
function auditApi<T extends object>(api: T, pluginId: string, audit: PluginAuditLog): T {
  const short = (value: unknown): string => {
    const text = typeof value === 'string' ? value : String(value ?? '');
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  };
  return new Proxy(api, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]): unknown => {
        switch (property) {
          case 'getNote':
            audit.record(pluginId, 'read', short(args[0]));
            break;
          case 'saveNote':
            audit.record(pluginId, 'write', short(args[0]));
            break;
          case 'getTree':
            audit.record(pluginId, 'read', 'tree');
            break;
          case 'search':
            audit.record(pluginId, 'read', `search:${short(args[0])}`);
            break;
          case 'query':
            audit.record(pluginId, 'read', `query:${short(args[0])}`);
            break;
          case 'tags':
            audit.record(pluginId, 'read', 'tags');
            break;
          default:
            break;
        }
        return (value as (...rest: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

export class PluginHost {
  private readonly runtimes = new Map<string, PluginRuntime>();
  private readonly deps: PluginHostDeps;
  private readonly log: PluginLogger;
  /** The audit log of the actions of the plugins (API 1.3.0). */
  private readonly auditLog: PluginAuditLog;
  /** Signature of the last known editor (used to detect a change). */
  private editorSignature: string | null = null;
  /** True when the editor was polled at least once. */
  private editorKnown = false;
  /** Cancels the subscription to the editor source. */
  private editorUnsubscribe: (() => void) | null = null;
  /**
   * The state of the encrypted storage published by the application.
   *
   * `undefined` means "unknown": the plugins see no state at all.
   */
  private publishedVault: PluginVaultStateLike | undefined;

  constructor(deps: PluginHostDeps) {
    this.deps = deps;
    this.log = deps.logger ?? createLogger('plugins');
    this.auditLog = deps.audit ?? new PluginAuditLog();
    if (deps.subscribeEditor) {
      this.editorUnsubscribe = deps.subscribeEditor((editor) => {
        this.editorSignature = this.signatureOf(editor);
        this.editorKnown = true;
        this.notifyEditorChange(editor);
      });
    }
  }

  /**
   * Publishes the state of the encrypted storage to the plugins.
   *
   * The application calls this when the storage is sealed, unlocked or
   * locked; the host keeps a frozen copy and hands it to every plugin as
   * `ctx.vault`. Passing `undefined` withdraws the state again.
   *
   * Only status information is published — the master password, the wrapping
   * key and the data key never leave the core.
   */
  publishVaultState(state: PluginVaultStateLike | undefined): void {
    this.publishedVault = state ? freezeVaultState(state) : undefined;
  }

  /**
   * The current state of the encrypted storage, as the plugins see it.
   *
   * The source is the application: the optional `getVaultState` dependency
   * first, then the state published with {@link PluginHost.publishVaultState}.
   * When nothing is published, the state is `undefined` (unknown).
   *
   * The returned value is always a frozen copy, so a plugin can never change
   * what the application published.
   */
  currentVaultState(): PluginVaultStateLike | undefined {
    const state = this.deps.getVaultState?.() ?? this.publishedVault;
    return state ? freezeVaultState(state) : undefined;
  }

  /**
   * The audit log of the actions of the plugins (API 1.3.0).
   *
   * The log is a bounded ring buffer: the plugin manager shows the last
   * actions of the plugins (open, read, write, command) with the plugin, the
   * action, the moment and the target.
   */
  audit(): PluginAuditLog {
    return this.auditLog;
  }

  /** The records of the audit log, the newest first. */
  auditEntries(): PluginAuditEntry[] {
    return this.auditLog.entries();
  }

  /**
   * Enables a plugin and activates it.
   *
   * Persistence of the flag is the job of the application layer (the
   * `SettingsStore`); the host only changes the in-memory state.
   */
  async enable(id: string): Promise<void> {
    if (!this.deps.registry.enable(id)) return;
    await this.activate(id);
  }

  /**
   * Disables a plugin and deactivates it.
   */
  async disable(id: string): Promise<void> {
    await this.deactivate(id);
    this.deps.registry.disable(id);
  }

  /**
   * Registers a plugin and activates it when it is enabled.
   */
  async registerPlugin(plugin: Plugin): Promise<void> {
    // A refused registration (duplicate id, invalid manifest, incompatible
    // API) is already reported through the registry state.
    this.deps.registry.register(plugin);
    const entry = this.deps.registry.get(plugin.manifest.id);
    if (entry?.enabled) await this.activate(plugin.manifest.id);
  }

  /**
   * Activates a plugin.
   *
   * Validation and compatibility are checked before the plugin code runs.
   * Any error thrown by the plugin is caught, reported through the registry
   * (`failed` state) and swallowed.
   */
  async activate(id: string): Promise<void> {
    const entry = this.deps.registry.get(id);
    if (!entry) {
      this.log.warn('cannot activate unknown plugin', id);
      return;
    }
    if (this.runtimes.has(id)) return;

    const { manifest } = entry.plugin;
    if (!isCompatible(manifest.minApiVersion, PLUGIN_API_VERSION)) {
      this.deps.registry.setState(
        id,
        'incompatible',
        `plugin requires API ${manifest.minApiVersion}, current API is ${PLUGIN_API_VERSION}`,
      );
      return;
    }

    // The manifest was validated by the registry and the API version is
    // compatible: the plugin is ready to be loaded.
    this.deps.registry.setState(id, 'validated');
    this.deps.registry.setState(id, 'loading');

    const runtime: PluginRuntime = {
      cleanups: [],
      deactivateCallbacks: [],
      editorWatchers: new Set(),
      eventSubscriptions: 0,
      panels: new Map(),
      sidebarItems: new Map(),
      contextMenuItems: new Map(),
      toolbarItems: new Map(),
      settingsSections: new Map(),
      sandboxes: new Map(),
    };
    this.runtimes.set(id, runtime);

    try {
      await this.applySettingsMigrations(id, manifest);
      if (manifest.sandbox) {
        // The plugin runs inside the sandbox: its code is in the frame, not
        // in the context of the application.
        this.activateSandbox(id, manifest, entry.plugin, runtime);
        this.deps.registry.setState(id, 'active');
        return;
      }
      await entry.plugin.activate(this.createContext(id, manifest, runtime));
      this.deps.registry.setState(id, 'active');
    } catch (err) {
      if (err instanceof PluginPermissionError) {
        // The plugin asked for something it is not allowed to do. That is not
        // a broken plugin: it stays active with the registrations it managed
        // to make, and the reason is reported through the registry.
        this.log.warn('plugin activation stopped by a permission error', id, err.message);
        this.deps.registry.setState(id, 'active', err.message);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.log.error('plugin activation failed', id, err);
      this.cleanupRuntime(id, runtime);
      this.runtimes.delete(id);
      this.deps.registry.setState(id, 'failed', message);
    }
  }

  /**
   * Activates a plugin that runs inside the sandbox (API 1.3.0).
   *
   * The code of the plugin is not executed here: it lives in the frame of the
   * sandbox and talks to the host through the bridge. The host builds the
   * handlers of the bridge from the restricted capabilities of the plugin, so
   * the permissions are enforced exactly as they are for a trusted plugin.
   *
   * The plugin gets a panel of its own: the frame is mounted there.
   */
  private activateSandbox(
    id: string,
    manifest: Plugin['manifest'],
    plugin: Plugin,
    runtime: PluginRuntime,
  ): void {
    const source = plugin.sandboxSource;
    if (!source) {
      throw new Error('the sandboxed plugin has no source');
    }
    const ctx = this.createContext(id, manifest, runtime);
    const handlers: SandboxHandlers = {
      'api.getNote': (args) => ctx.api.getNote(String(args[0] ?? '')),
      'api.getTree': () => ctx.api.getTree(),
      'api.search': (args) =>
        ctx.api.search(String(args[0] ?? ''), typeof args[1] === 'number' ? args[1] : undefined),
      'api.query': (args) => {
        const query = ctx.api.query;
        if (!query) throw new Error('the query capability is not available in this build');
        return query.call(ctx.api, String(args[0] ?? ''), typeof args[1] === 'number' ? args[1] : undefined);
      },
      'api.tags': () => {
        const tags = ctx.api.tags;
        if (!tags) throw new Error('the query capability is not available in this build');
        return tags.call(ctx.api);
      },
      'editor.getText': () => ctx.editor?.getText() ?? '',
      'editor.getSelection': () => ctx.editor?.getSelection() ?? '',
      'editor.getCursor': () => ctx.editor?.getCursor() ?? { from: 0, to: 0 },
      'editor.getPath': () => ctx.editor?.getPath() ?? null,
      'openNote': (args) => {
        if (!ctx.openNote) throw new Error('the host cannot open notes');
        ctx.openNote(String(args[0] ?? ''));
        return null;
      },
      'log': (args) => {
        ctx.logger.info(String(args[0] ?? ''));
        return null;
      },
    };

    const sandbox = new PluginSandbox({
      pluginId: id,
      source,
      handlers,
      onRefuse: (message) => {
        this.log.warn('the sandbox of the plugin was refused', id, message);
      },
    });
    runtime.sandboxes.set(id, sandbox);
    runtime.cleanups.push(() => {
      sandbox.dispose();
      runtime.sandboxes.delete(id);
    });

    const panelId = `${id}.panel`;
    runtime.panels.set(panelId, {
      id: panelId,
      title: manifest.name,
      render: () =>
        h('div', {
          class: 'noto-plugin-sandbox',
          'data-plugin-sandbox': id,
          ref: (element: Element | null) => {
            if (element && !sandbox.element.isConnected) sandbox.attach(element as HTMLElement);
          },
        }),
    });
  }

  /**
   * Deactivates a plugin.
   *
   * All registrations of the plugin are removed: commands, panels, sidebar
   * items, context menu items, toolbar items, settings sections and event
   * subscriptions. Cleanup callbacks run in reverse registration order.
   */
  async deactivate(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    const entry = this.deps.registry.get(id);
    if (!runtime || !entry) {
      if (entry) this.deps.registry.setState(id, 'disabled');
      return;
    }

    // The plugin's own deactivate hook runs first, then the cleanups in
    // reverse order of registration.
    try {
      await entry.plugin.deactivate?.();
    } catch (err) {
      this.log.error('plugin deactivate failed', id, err);
    }
    for (const cb of runtime.deactivateCallbacks.slice().reverse()) {
      try {
        cb();
      } catch (err) {
        this.log.warn('plugin deactivate callback failed', id, err);
      }
    }
    this.cleanupRuntime(id, runtime);
    this.runtimes.delete(id);
    this.deps.registry.setState(id, 'disabled');
  }

  /** Deactivates every active plugin. */
  async disposeAll(): Promise<void> {
    for (const id of Array.from(this.runtimes.keys())) {
      await this.deactivate(id);
    }
    this.editorUnsubscribe?.();
    this.editorUnsubscribe = null;
  }

  /** Emits an event to all plugins (and to the rest of the application). */
  emit<K extends PluginEventName>(event: K, payload: PluginEventMap[K]): void {
    // Polls the editor: a change of the editor is noticed even when no
    // plugin reads `ctx.editor` at that moment.
    this.currentEditor();
    this.deps.bus.emit(event, payload);
  }

  /** Runs a registered command. */
  runCommand(id: string): Promise<void> | void {
    return this.deps.commands.run(id);
  }

  /** Panels contributed by the currently active plugins. */
  panels(): PluginPanel[] {
    return this.collect((runtime) => Array.from(runtime.panels.values()));
  }

  /** Sidebar items contributed by the currently active plugins. */
  sidebarItems(): PluginSidebarItem[] {
    return this.collect((runtime) => Array.from(runtime.sidebarItems.values()));
  }

  /** Context menu items contributed by the currently active plugins. */
  contextMenuItems(): PluginContextMenuItem[] {
    return this.collect((runtime) => Array.from(runtime.contextMenuItems.values()));
  }

  /** Toolbar items contributed by the currently active plugins. */
  toolbarItems(): PluginToolbarItem[] {
    return this.collect((runtime) => Array.from(runtime.toolbarItems.values()));
  }

  /** Settings sections contributed by the currently active plugins. */
  settingsSections(): PluginSettingsSection[] {
    return this.collect((runtime) => Array.from(runtime.settingsSections.values()));
  }

  /**
   * Number of live registrations, for diagnostics and tests.
   *
   * `events` counts the subscriptions to the event bus, not every cleanup
   * callback: the registrations of the UI and the settings are counted by
   * their own counters.
   *
   * After a `deactivate()` all counters of that plugin are zero.
   */
  counts(): {
    plugins: number;
    commands: number;
    panels: number;
    sidebarItems: number;
    contextMenuItems: number;
    toolbarItems: number;
    settingsSections: number;
    events: number;
  } {
    let panels = 0;
    let sidebarItems = 0;
    let contextMenuItems = 0;
    let toolbarItems = 0;
    let settingsSections = 0;
    let events = 0;
    for (const runtime of this.runtimes.values()) {
      panels += runtime.panels.size;
      sidebarItems += runtime.sidebarItems.size;
      contextMenuItems += runtime.contextMenuItems.size;
      toolbarItems += runtime.toolbarItems.size;
      settingsSections += runtime.settingsSections.size;
    }
    for (const runtime of this.runtimes.values()) {
      events += runtime.eventSubscriptions;
    }
    return {
      plugins: this.runtimes.size,
      commands: this.deps.commands.count(),
      panels,
      sidebarItems,
      contextMenuItems,
      toolbarItems,
      settingsSections,
      events,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private collect<T>(pick: (runtime: PluginRuntime) => T[]): T[] {
    const out: T[] = [];
    for (const runtime of this.runtimes.values()) out.push(...pick(runtime));
    return out;
  }

  private cleanupRuntime(id: string, runtime: PluginRuntime): void {
    for (const cleanup of runtime.cleanups.slice().reverse()) {
      try {
        cleanup();
      } catch (err) {
        this.log.warn('plugin cleanup failed', id, err);
      }
    }
    runtime.cleanups.length = 0;
    runtime.deactivateCallbacks.length = 0;
    runtime.editorWatchers.clear();
    runtime.eventSubscriptions = 0;
    runtime.panels.clear();
    runtime.sidebarItems.clear();
    runtime.contextMenuItems.clear();
    runtime.toolbarItems.clear();
    runtime.settingsSections.clear();
    // Commands are owned by the plugin and removed in one go.
    this.deps.commands.unregisterAll(id);
  }

  /**
   * The current editor of the application.
   *
   * The editor is polled on every request, so the plugin always sees the
   * editor that is open NOW. When the editor changed, the plugins that
   * subscribed with `ctx.onEditor` are notified and the `editor.available`
   * event is emitted.
   */
  private currentEditor(): PluginEditor | null {
    const editor = this.deps.getEditor();
    const signature = this.signatureOf(editor);
    if (!this.editorKnown || signature !== this.editorSignature) {
      this.editorKnown = true;
      this.editorSignature = signature;
      this.notifyEditorChange(editor);
    }
    return editor;
  }

  /**
   * A cheap fingerprint of the editor.
   *
   * The application creates a new editor object on every request, so the
   * identity cannot be compared: the path of the open note is used instead.
   * It detects the appearance, the disappearance and the change of the note.
   */
  private signatureOf(editor: PluginEditor | null): string | null {
    if (!editor) return null;
    try {
      return editor.getPath() ?? '';
    } catch {
      return '';
    }
  }

  /** Notifies the plugins about a new editor and emits the event. */
  private notifyEditorChange(editor: PluginEditor | null): void {
    for (const runtime of this.runtimes.values()) {
      for (const watcher of Array.from(runtime.editorWatchers)) {
        try {
          watcher(editor);
        } catch (err) {
          this.log.warn('plugin editor watcher failed', err);
        }
      }
    }
    let path: string | null = null;
    if (editor) {
      try {
        path = editor.getPath();
      } catch {
        path = null;
      }
    }
    this.deps.bus.emit('editor.available', { path });
  }

  private async applySettingsMigrations(
    id: string,
    manifest: Plugin['manifest'],
  ): Promise<void> {
    const target = manifest.settingsVersion ?? 0;
    const migrations = manifest.settingsMigrations;
    if (!migrations || target <= 0) return;
    try {
      await this.deps.settings.migrateSettings(id, target, migrations);
    } catch (err) {
      this.log.warn('settings migration failed', id, err);
    }
  }

  private createContext(
    id: string,
    manifest: Plugin['manifest'],
    runtime: PluginRuntime,
  ): PluginContext {
    const logger = createLogger(id);
    // The getter of `ctx.editor` needs the host, not the context object.
    const host = this;
    // A frozen copy: the plugin cannot change its own permissions.
    const permissions: readonly string[] = Object.freeze([...(manifest.permissions ?? [])]);
    // The plugin only gets the restricted API, never the original one.
    // The wrapper of the audit log records every call of the plugin.
    const api = auditApi(
      restrictPluginApi(this.deps.createApi(id), id, permissions),
      id,
      this.auditLog,
    );

    const track = (cleanup: () => void): (() => void) => {
      let active = true;
      runtime.cleanups.push(() => {
        if (!active) return;
        active = false;
        cleanup();
      });
      return () => {
        if (!active) return;
        active = false;
        const index = runtime.cleanups.indexOf(cleanup);
        if (index >= 0) runtime.cleanups.splice(index, 1);
        cleanup();
      };
    };

    // The editor of the application is live: it is read from the host every
    // time the plugin asks for it, so a plugin that was activated before the
    // first note was opened still gets the editor later.
    const restrictedEditor = (raw: PluginEditor | null): PluginEditor | null => {
      if (!raw) return null;
      return restrictEditor(raw, id, permissions);
    };

    const settings: PluginSettings = {
      // Reading the own settings of the plugin needs no permission: the
      // namespace belongs to the plugin itself.
      get: async <T>(key: string): Promise<T | undefined> => {
        const fallback = this.defaultFor(manifest, key);
        const value = await this.deps.settings.get<T | undefined>(
          id,
          key,
          fallback as T | undefined,
        );
        return value;
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        requirePermission(id, permissions, 'settings.write');
        await this.deps.settings.set(id, key, value);
      },
      reset: async (key?: string): Promise<void> => {
        requirePermission(id, permissions, 'settings.write');
        await this.deps.settings.reset(id, key);
      },
      all: async (): Promise<Record<string, unknown>> => {
        const stored = await this.deps.settings.getAll(id);
        const out: Record<string, unknown> = {};
        for (const schema of manifest.settings ?? []) {
          const value = stored[schema.key];
          if (value === undefined) {
            out[schema.key] = schema.default;
            continue;
          }
          if (typeof value !== schema.type) {
            // A value of the wrong type is broken: the default is used.
            console.warn(
              `[noto:plugins] setting ${id}:${schema.key} has type ${typeof value}, ` +
                `expected ${schema.type}, using the default`,
            );
            out[schema.key] = schema.default;
            continue;
          }
          out[schema.key] = value;
        }
        for (const [key, value] of Object.entries(stored)) {
          if (!(key in out)) out[key] = value;
        }
        return out;
      },
    };

    const context: PluginContext = {
      id,
      version: manifest.version,
      logger,
      permissions: permissions as readonly PluginPermission[],
      api,
      get editor(): PluginEditor | null {
        return restrictedEditor(host.currentEditor());
      },
      settings,
      /**
       * Opens a note in the editor (API 1.3.0).
       *
       * The operation needs the permission `notes.read`: a plugin navigates
       * only to a note it is allowed to read. The action is recorded in the
       * audit log of the host.
       */
      openNote: (path: string): void => {
        requirePermission(id, permissions, 'notes.read');
        const opener = this.deps.openNote;
        if (!opener) {
          throw new Error('the host cannot open notes');
        }
        this.auditLog.record(id, 'open', path);
        void opener(path);
      },
      // The state of the encrypted storage is live: it is read from the
      // application on every access, so a plugin always sees the current
      // state. A frozen copy, so the plugin can never change it.
      get vault(): PluginVaultStateLike | undefined {
        // The API may already carry the published state (the application
        // creates it with `createPluginApi({ ... }, { vaultState })`).
        return host.currentVaultState() ?? api.vault;
      },
      registerCommand: (cmd: PluginCommand): (() => void) => {
        requirePermission(id, permissions, 'ui.contribute');
        // The run of the command is recorded in the audit log (API 1.3.0).
        const audited: PluginCommand = {
          ...cmd,
          run: (): void | Promise<void> => {
            this.auditLog.record(id, 'command', cmd.id);
            return cmd.run();
          },
        };
        const unregister = this.deps.commands.register(id, audited);
        return track(unregister);
      },
      registerPanel: (panel: PluginPanel): (() => void) => {
        requirePermission(id, permissions, 'ui.contribute');
        runtime.panels.set(panel.id, panel);
        return track(() => {
          if (runtime.panels.get(panel.id) === panel) runtime.panels.delete(panel.id);
        });
      },
      registerSidebarItem: (item: PluginSidebarItem): (() => void) => {
        requirePermission(id, permissions, 'ui.contribute');
        runtime.sidebarItems.set(item.id, item);
        return track(() => {
          if (runtime.sidebarItems.get(item.id) === item) runtime.sidebarItems.delete(item.id);
        });
      },
      registerContextMenuItem: (item: PluginContextMenuItem): (() => void) => {
        requirePermission(id, permissions, 'ui.contribute');
        runtime.contextMenuItems.set(item.id, item);
        return track(() => {
          if (runtime.contextMenuItems.get(item.id) === item) runtime.contextMenuItems.delete(item.id);
        });
      },
      registerToolbarItem: (item: PluginToolbarItem): (() => void) => {
        requirePermission(id, permissions, 'ui.contribute');
        runtime.toolbarItems.set(item.id, item);
        return track(() => {
          if (runtime.toolbarItems.get(item.id) === item) runtime.toolbarItems.delete(item.id);
        });
      },
      registerSettingsSection: (section: PluginSettingsSection): (() => void) => {
        requirePermission(id, permissions, 'ui.contribute');
        runtime.settingsSections.set(section.id, section);
        return track(() => {
          if (runtime.settingsSections.get(section.id) === section) {
            runtime.settingsSections.delete(section.id);
          }
        });
      },
      on: <K extends PluginEventName>(
        event: K,
        cb: (payload: PluginEventMap[K]) => void,
      ): (() => void) => {
        const unsubscribe = this.deps.bus.on(event, cb);
        runtime.eventSubscriptions += 1;
        return track(() => {
          unsubscribe();
          runtime.eventSubscriptions -= 1;
        });
      },
      onEditor: (cb: (editor: PluginEditor | null) => void): (() => void) => {
        // The watcher receives the raw editor and hands the restricted one
        // to the plugin, so the permissions are enforced here too.
        const watcher = (raw: PluginEditor | null): void => {
          cb(restrictedEditor(raw));
        };
        // The editor is polled BEFORE the watcher is registered, so that the
        // callback is called exactly once with the current editor.
        const current = this.currentEditor();
        runtime.editorWatchers.add(watcher);
        let active = true;
        try {
          watcher(current);
        } catch (err) {
          this.log.warn('plugin editor callback failed', id, err);
        }
        return () => {
          if (!active) return;
          active = false;
          runtime.editorWatchers.delete(watcher);
        };
      },
      onDeactivate: (cb: () => void): void => {
        runtime.deactivateCallbacks.push(cb);
      },
    };

    return context;
  }

  private defaultFor(manifest: Plugin['manifest'], key: string): unknown {
    for (const schema of manifest.settings ?? []) {
      if (schema.key === key) return schema.default;
    }
    return undefined;
  }
}
