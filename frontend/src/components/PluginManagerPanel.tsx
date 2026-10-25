// The screen that manages the plugins.
//
// The component is deliberately "dumb": it receives the state of the plugins
// and the actions as props and never reads the global state itself, so it can
// be rendered (and tested) in isolation.
import type { PluginAuditEntry, PluginManifest } from '../plugins/contract';
import type { PluginSource } from '../plugins/registry';
import { useT, type Translator } from '../i18n/useT';
import '../styles/plugin-manager.css';

/** The states a plugin can be shown in. */
export type PluginManagerStatus = 'active' | 'disabled' | 'failed' | 'incompatible';

/** One plugin of the list. */
export interface PluginManagerEntry {
  id: string;
  manifest: PluginManifest;
  status: PluginManagerStatus;
  /** The message of the last failure (`failed` only). */
  error?: string | null;
  /** Where the plugin comes from (built-in, a file, a URL). */
  source?: PluginSource;
}

export interface PluginManagerPanelProps {
  plugins: PluginManagerEntry[];
  onEnable(id: string): void;
  onDisable(id: string): void;
  /** Opens the settings of the plugin; only called when it has settings. */
  onOpenSettings(id: string): void;
  /** Resets the stored settings of the plugin. */
  onResetSettings(id: string): void;
  /**
   * The last actions of the plugins (API 1.3.0).
   *
   * The list comes from the audit log of the host: the newest action is the
   * first one. The panel shows nothing when the list is empty.
   */
  audit?: readonly PluginAuditEntry[];
}

const STATUS_LABELS: Record<PluginManagerStatus, string> = {
  active: 'plugins.status.active',
  disabled: 'plugins.status.disabled',
  failed: 'plugins.status.failed',
  incompatible: 'plugins.status.incompatible',
};

/** The label of the origin of a plugin. */
function sourceLabel(source: PluginSource | undefined, t: Translator): string | null {
  if (!source) return null;
  if (source.kind === 'builtin') return t('plugins.sourceBuiltin');
  if (source.kind === 'file') return t('plugins.sourceFile', { location: source.location });
  return t('plugins.sourceUrl', { location: source.location });
}

/** The label of an action of a plugin (the audit log). */
const ACTION_LABELS: Record<PluginAuditEntry['action'], string> = {
  open: 'plugins.action.open',
  read: 'plugins.action.read',
  write: 'plugins.action.write',
  command: 'plugins.action.command',
};

export function PluginManagerPanel(props: PluginManagerPanelProps) {
  const t = useT();
  return (
    <section class="noto-plugin-manager" aria-label={t('plugins.label')}>
      <p class="noto-plugin-trust-warning" role="note">
        {t('plugins.trustWarning')}
      </p>

      {props.plugins.length === 0 ? (
        <p class="noto-plugin-empty">{t('plugins.empty')}</p>
      ) : (
        <ul class="noto-plugin-list" role="list" aria-label={t('plugins.installed')}>
          {props.plugins.map((plugin) => {
            const { manifest } = plugin;
            const hasSettings = Array.isArray(manifest.settings) && manifest.settings.length > 0;
            const source = sourceLabel(plugin.source, t);
            return (
              <li key={plugin.id} class="noto-plugin-list-item" data-plugin-id={plugin.id}>
                <div class="noto-plugin-list-header">
                  <span class="noto-plugin-name">{manifest.name}</span>
                  <span class="noto-plugin-version">{manifest.version}</span>
                  <span
                    class={`noto-plugin-status noto-plugin-status-${plugin.status}`}
                    data-plugin-status={plugin.status}
                  >
                    {t(STATUS_LABELS[plugin.status])}
                  </span>
                </div>

                {manifest.description ? (
                  <p class="noto-plugin-description">{manifest.description}</p>
                ) : null}
                {manifest.author ? (
                  <p class="noto-plugin-author">{t('plugins.author', { author: manifest.author })}</p>
                ) : null}
                {source ? (
                  <p class="noto-plugin-source">{t('plugins.source', { source })}</p>
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
                      aria-label={t('plugins.reloadLabel', { name: manifest.name })}
                      onClick={() => {
                        // A failed plugin is disabled first and activated
                        // again afterwards.
                        props.onDisable(plugin.id);
                        props.onEnable(plugin.id);
                      }}
                    >
                      {t('plugins.reload')}
                    </button>
                  ) : null}

                  {plugin.status === 'active' ? (
                    <button
                      type="button"
                      class="noto-plugin-button"
                      aria-label={t('plugins.disableLabel', { name: manifest.name })}
                      onClick={() => props.onDisable(plugin.id)}
                    >
                      {t('plugins.disable')}
                    </button>
                  ) : null}

                  {plugin.status === 'disabled' ? (
                    <button
                      type="button"
                      class="noto-plugin-button"
                      aria-label={t('plugins.enableLabel', { name: manifest.name })}
                      onClick={() => props.onEnable(plugin.id)}
                    >
                      {t('plugins.enable')}
                    </button>
                  ) : null}

                  {hasSettings ? (
                    <>
                      <button
                        type="button"
                        class="noto-plugin-button"
                        aria-label={t('plugins.openSettingsLabel', { name: manifest.name })}
                        onClick={() => props.onOpenSettings(plugin.id)}
                      >
                        {t('plugins.openSettings')}
                      </button>
                      <button
                        type="button"
                        class="noto-plugin-button"
                        aria-label={t('plugins.resetSettingsLabel', { name: manifest.name })}
                        onClick={() => props.onResetSettings(plugin.id)}
                      >
                        {t('plugins.resetSettings')}
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {props.audit && props.audit.length > 0 ? (
        <section class="noto-plugin-audit" aria-label={t('plugins.auditLabel')}>
          <h3 class="noto-plugin-audit-title">{t('plugins.auditTitle')}</h3>
          <ul class="noto-plugin-audit-list" role="list">
            {props.audit.map((entry, index) => (
              <li
                key={`${entry.at}:${entry.pluginId}:${entry.action}:${entry.target}:${index}`}
                class="noto-plugin-audit-item"
                data-plugin-audit-action={entry.action}
              >
                <span class="noto-plugin-audit-plugin">{entry.pluginId}</span>
                <span class="noto-plugin-audit-action">{t(ACTION_LABELS[entry.action])}</span>
                <span class="noto-plugin-audit-target">{entry.target}</span>
                <time class="noto-plugin-audit-time" dateTime={entry.at}>
                  {entry.at}
                </time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
