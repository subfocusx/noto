// The screen that manages the plugins.
//
// The component is deliberately "dumb": it receives the state of the plugins
// and the actions as props and never reads the global state itself, so it can
// be rendered (and tested) in isolation.
import type { PluginManifest } from '../plugins/contract';

/** The states a plugin can be shown in. */
export type PluginManagerStatus = 'active' | 'disabled' | 'failed' | 'incompatible';

/** One plugin of the list. */
export interface PluginManagerEntry {
  id: string;
  manifest: PluginManifest;
  status: PluginManagerStatus;
  /** The message of the last failure (`failed` only). */
  error?: string | null;
}

export interface PluginManagerPanelProps {
  plugins: PluginManagerEntry[];
  onEnable(id: string): void;
  onDisable(id: string): void;
  /** Opens the settings of the plugin; only called when it has settings. */
  onOpenSettings(id: string): void;
  /** Resets the stored settings of the plugin. */
  onResetSettings(id: string): void;
}

const STATUS_LABELS: Record<PluginManagerStatus, string> = {
  active: 'Active',
  disabled: 'Disabled',
  failed: 'Failed',
  incompatible: 'Incompatible',
};

export function PluginManagerPanel(props: PluginManagerPanelProps) {
  return (
    <section class="noto-plugin-manager" aria-label="Plugins">
      <p class="noto-plugin-trust-warning" role="note">
        Встроенные плагины выполняются как доверенный код в приложении. Изоляции/песочницы нет.
      </p>

      {props.plugins.length === 0 ? (
        <p class="noto-plugin-empty">No plugins installed.</p>
      ) : (
        <ul class="noto-plugin-list" role="list" aria-label="Installed plugins">
          {props.plugins.map((plugin) => {
            const { manifest } = plugin;
            const hasSettings = Array.isArray(manifest.settings) && manifest.settings.length > 0;
            return (
              <li key={plugin.id} class="noto-plugin-list-item" data-plugin-id={plugin.id}>
                <div class="noto-plugin-list-header">
                  <span class="noto-plugin-name">{manifest.name}</span>
                  <span class="noto-plugin-version">{manifest.version}</span>
                  <span
                    class={`noto-plugin-status noto-plugin-status-${plugin.status}`}
                    data-plugin-status={plugin.status}
                  >
                    {STATUS_LABELS[plugin.status]}
                  </span>
                </div>

                {manifest.description ? (
                  <p class="noto-plugin-description">{manifest.description}</p>
                ) : null}
                {manifest.author ? (
                  <p class="noto-plugin-author">Author: {manifest.author}</p>
                ) : null}

                {plugin.status === 'failed' && plugin.error ? (
                  <p class="noto-plugin-error-text" role="alert">
                    {plugin.error}
                  </p>
                ) : null}

                <div class="noto-plugin-list-actions">
                  {plugin.status === 'failed' ? (
                    <button
                      type="button"
                      class="noto-plugin-button"
                      aria-label={`Disable and reload the plugin ${manifest.name}`}
                      onClick={() => {
                        // A failed plugin is disabled first and activated
                        // again afterwards.
                        props.onDisable(plugin.id);
                        props.onEnable(plugin.id);
                      }}
                    >
                      Отключить и перезагрузить
                    </button>
                  ) : null}

                  {plugin.status === 'active' ? (
                    <button
                      type="button"
                      class="noto-plugin-button"
                      aria-label={`Disable the plugin ${manifest.name}`}
                      onClick={() => props.onDisable(plugin.id)}
                    >
                      Disable
                    </button>
                  ) : null}

                  {plugin.status === 'disabled' ? (
                    <button
                      type="button"
                      class="noto-plugin-button"
                      aria-label={`Enable the plugin ${manifest.name}`}
                      onClick={() => props.onEnable(plugin.id)}
                    >
                      Enable
                    </button>
                  ) : null}

                  {hasSettings ? (
                    <>
                      <button
                        type="button"
                        class="noto-plugin-button"
                        aria-label={`Open the settings of the plugin ${manifest.name}`}
                        onClick={() => props.onOpenSettings(plugin.id)}
                      >
                        Открыть настройки
                      </button>
                      <button
                        type="button"
                        class="noto-plugin-button"
                        aria-label={`Reset the settings of the plugin ${manifest.name}`}
                        onClick={() => props.onResetSettings(plugin.id)}
                      >
                        Сбросить настройки
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
