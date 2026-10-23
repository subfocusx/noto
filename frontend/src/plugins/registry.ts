// Static registry of built-in plugins.
//
// The registry only knows *about* plugins: it validates manifests, tracks
// the lifecycle state and remembers which plugins are enabled. Activation
// (calling into plugin code) is the job of the {@link PluginHost}.
//
// Persistence of the enabled/disabled flags is a separate layer (the host
// may read them from `SettingsStore`); here the state lives in memory and
// changes are announced through `onStateChange`.
import {
  PLUGIN_API_VERSION,
  type Plugin,
  type PluginManifest,
  type PluginState,
} from './contract';
import { isCompatible, validateManifest } from './manifest';

/** A registry entry as seen by the UI. */
export interface PluginRegistryEntry {
  plugin: Plugin;
  state: PluginState;
  error?: string;
  /** True when the plugin is enabled (activation may still be pending). */
  enabled: boolean;
}

/** Callback fired whenever the state of a plugin changes. */
export type PluginStateChangeListener = (
  id: string,
  state: PluginState,
  error?: string,
) => void;

export class PluginRegistry {
  private readonly entries = new Map<string, PluginRegistryEntry>();
  private readonly stateListeners = new Set<PluginStateChangeListener>();

  /**
   * Registers a plugin.
   *
   * A duplicate id is refused (the existing plugin is kept). A plugin with
   * an invalid manifest is registered in the `failed` state together with
   * the list of validation errors; a plugin that requires a newer API is
   * registered in the `incompatible` state.
   */
  register(plugin: Plugin): { ok: boolean; error?: string } {
    const manifest: PluginManifest = plugin.manifest;
    const id = manifest && typeof manifest.id === 'string' ? manifest.id : '';

    if (id && this.entries.has(id)) {
      return { ok: false, error: `plugin "${id}" is already registered` };
    }

    const validation = validateManifest(manifest);
    if (!validation.ok) {
      const error = validation.errors.join('; ');
      this.entries.set(id, { plugin, state: 'failed', error, enabled: false });
      this.notify(id, 'failed', error);
      return { ok: false, error };
    }

    if (!isCompatible(manifest.minApiVersion, PLUGIN_API_VERSION)) {
      const error = `plugin requires API ${manifest.minApiVersion}, current API is ${PLUGIN_API_VERSION}`;
      this.entries.set(id, { plugin, state: 'incompatible', error, enabled: false });
      this.notify(id, 'incompatible', error);
      return { ok: false, error };
    }

    this.entries.set(id, { plugin, state: 'discovered', enabled: false });
    this.notify(id, 'discovered');
    return { ok: true };
  }

  /** Marks a plugin as enabled. Returns false when the plugin is unknown. */
  enable(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (entry.state === 'failed' || entry.state === 'incompatible') return false;
    entry.enabled = true;
    this.setState(id, 'enabled');
    return true;
  }

  /** Marks a plugin as disabled. Returns false when the plugin is unknown. */
  disable(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.enabled = false;
    this.setState(id, 'disabled');
    return true;
  }

  /** Sets the state of a plugin (used by the host during activation). */
  setState(id: string, state: PluginState, error?: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.state = state;
    if (error === undefined) delete entry.error;
    else entry.error = error;
    this.notify(id, state, error);
  }

  /** The registry entry of a plugin, or undefined. */
  get(id: string): PluginRegistryEntry | undefined {
    return this.entries.get(id);
  }

  /** All registered plugins with their state. */
  list(): PluginRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /** A snapshot of the state of every plugin. */
  states(): Map<string, PluginState> {
    const out = new Map<string, PluginState>();
    for (const [id, entry] of this.entries) out.set(id, entry.state);
    return out;
  }

  /**
   * Subscribes to state changes.
   *
   * @returns an idempotent unsubscribe function.
   */
  onStateChange(listener: PluginStateChangeListener): () => void {
    this.stateListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.stateListeners.delete(listener);
    };
  }

  private notify(id: string, state: PluginState, error?: string): void {
    for (const listener of Array.from(this.stateListeners)) {
      try {
        listener(id, state, error);
      } catch (err) {
        console.warn('[noto:plugins] state listener failed', err);
      }
    }
  }
}
