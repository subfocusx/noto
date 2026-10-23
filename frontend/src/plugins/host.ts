// The plugin host: activates plugins and owns everything they register.
//
// The host is the only place where plugin code runs. It builds a
// {@link PluginContext} that exposes exactly the capabilities listed in the
// contract — a plugin can never reach application internals.
//
// Failure policy: a plugin that throws during activation is put into the
// `failed` state with the error message; the error is never propagated to
// the caller, so the application keeps working.
import type {
  Plugin,
  PluginApi,
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
import type { PluginRegistry } from './registry';
import type { EventBus } from '../core/events/eventBus';
import type { CommandRegistry } from '../core/commands/commandRegistry';
import type { SettingsStore } from '../core/settings/settingsStore';
import { createLogger } from '../core/diagnostics/logger';

/** Dependencies of the {@link PluginHost}. */
export interface PluginHostDeps {
  registry: PluginRegistry;
  bus: EventBus<PluginEventMap>;
  commands: CommandRegistry;
  settings: SettingsStore;
  createApi(pluginId: string): PluginApi;
  getEditor(): PluginEditor | null;
  logger?: PluginLogger;
}

interface PluginRuntime {
  cleanups: Array<() => void>;
  deactivateCallbacks: Array<() => void>;
  panels: Map<string, PluginPanel>;
  sidebarItems: Map<string, PluginSidebarItem>;
  contextMenuItems: Map<string, PluginContextMenuItem>;
  toolbarItems: Map<string, PluginToolbarItem>;
  settingsSections: Map<string, PluginSettingsSection>;
}

export class PluginHost {
  private readonly runtimes = new Map<string, PluginRuntime>();
  private readonly deps: PluginHostDeps;
  private readonly log: PluginLogger;

  constructor(deps: PluginHostDeps) {
    this.deps = deps;
    this.log = deps.logger ?? createLogger('plugins');
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

    this.deps.registry.setState(id, 'loading');

    const runtime: PluginRuntime = {
      cleanups: [],
      deactivateCallbacks: [],
      panels: new Map(),
      sidebarItems: new Map(),
      contextMenuItems: new Map(),
      toolbarItems: new Map(),
      settingsSections: new Map(),
    };
    this.runtimes.set(id, runtime);

    try {
      await this.applySettingsMigrations(id, manifest);
      await entry.plugin.activate(this.createContext(id, manifest, runtime));
      this.deps.registry.setState(id, 'active');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error('plugin activation failed', id, err);
      this.cleanupRuntime(id, runtime);
      this.runtimes.delete(id);
      this.deps.registry.setState(id, 'failed', message);
    }
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
  }

  /** Emits an event to all plugins (and to the rest of the application). */
  emit<K extends PluginEventName>(event: K, payload: PluginEventMap[K]): void {
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
      events += runtime.cleanups.length;
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
    runtime.panels.clear();
    runtime.sidebarItems.clear();
    runtime.contextMenuItems.clear();
    runtime.toolbarItems.clear();
    runtime.settingsSections.clear();
    // Commands are owned by the plugin and removed in one go.
    this.deps.commands.unregisterAll(id);
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
    const api = this.deps.createApi(id);
    const editor = this.deps.getEditor();

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

    const settings: PluginSettings = {
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
        await this.deps.settings.set(id, key, value);
      },
      reset: async (key?: string): Promise<void> => {
        await this.deps.settings.reset(id, key);
      },
      all: async (): Promise<Record<string, unknown>> => {
        const stored = await this.deps.settings.getAll(id);
        const out: Record<string, unknown> = {};
        for (const schema of manifest.settings ?? []) {
          out[schema.key] = schema.key in stored ? stored[schema.key] : schema.default;
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
      permissions: manifest.permissions as readonly PluginPermission[],
      api,
      editor,
      settings,
      registerCommand: (cmd: PluginCommand): (() => void) => {
        const unregister = this.deps.commands.register(id, cmd);
        return track(unregister);
      },
      registerPanel: (panel: PluginPanel): (() => void) => {
        runtime.panels.set(panel.id, panel);
        return track(() => {
          if (runtime.panels.get(panel.id) === panel) runtime.panels.delete(panel.id);
        });
      },
      registerSidebarItem: (item: PluginSidebarItem): (() => void) => {
        runtime.sidebarItems.set(item.id, item);
        return track(() => {
          if (runtime.sidebarItems.get(item.id) === item) runtime.sidebarItems.delete(item.id);
        });
      },
      registerContextMenuItem: (item: PluginContextMenuItem): (() => void) => {
        runtime.contextMenuItems.set(item.id, item);
        return track(() => {
          if (runtime.contextMenuItems.get(item.id) === item) runtime.contextMenuItems.delete(item.id);
        });
      },
      registerToolbarItem: (item: PluginToolbarItem): (() => void) => {
        runtime.toolbarItems.set(item.id, item);
        return track(() => {
          if (runtime.toolbarItems.get(item.id) === item) runtime.toolbarItems.delete(item.id);
        });
      },
      registerSettingsSection: (section: PluginSettingsSection): (() => void) => {
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
        return track(unsubscribe);
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
