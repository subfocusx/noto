// Contribution points for the plugins.
//
// The containers of this module render what the plugins have registered and
// nothing else: the shell decides where they are placed, the plugins decide
// what they look like.
//
// Every contribution is wrapped into a `PluginErrorBoundary`: a plugin that
// throws while it is rendered must not break the layout of the application.
import { Component, type ComponentChildren } from 'preact';
import type {
  PluginCommand,
  PluginContextMenuItem,
  PluginSidebarItem,
  PluginToolbarItem,
} from '../plugins/contract';
import { Icon } from '../ui/icons';
import { t } from '../i18n';
import { useT } from '../i18n/useT';
import '../styles/plugin-activity.css';
import '../styles/plugin-links.css';
import '../styles/plugin-graph.css';
import '../styles/plugin-sandbox.css';

/* ----------------------------------------------------------- error boundary */

export interface PluginErrorBoundaryProps {
  /** A readable name of the plugin, used in the error message. */
  label?: string;
  children?: ComponentChildren;
}

interface PluginErrorBoundaryState {
  failed: boolean;
}

/**
 * Catches the errors of a plugin contribution.
 *
 * Preact has no `getDerivedStateFromError` in the React sense, but it does
 * support the static method, so the subtree is replaced by a message instead
 * of taking the whole application down.
 */
export class PluginErrorBoundary extends Component<
  PluginErrorBoundaryProps,
  PluginErrorBoundaryState
> {
  override state: PluginErrorBoundaryState = { failed: false };

  static override getDerivedStateFromError(): PluginErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    // eslint-disable-next-line no-console
    console.error('plugin contribution failed', this.props.label, error);
  }

  override render(): ComponentChildren {
    if (this.state.failed) {
      return (
        <div class="noto-plugin-error" role="alert">
          {this.props.label
            ? t('plugins.errorWithLabel', { label: this.props.label })
            : t('plugins.error')}
        </div>
      );
    }
    return this.props.children ?? null;
  }
}

/* -------------------------------------------------------------- sidebar */

export interface PluginSidebarSlotProps {
  items: PluginSidebarItem[];
}

/**
 * The sidebar entries of the plugins.
 *
 * The entries are icon-only buttons: the name of the entry stays in the
 * `aria-label` and in the tooltip of the button.
 */
export function PluginSidebarSlot(props: PluginSidebarSlotProps) {
  const t = useT();
  if (props.items.length === 0) return null;
  return (
    <ul class="noto-plugin-sidebar" role="list" aria-label={t('plugins.label')}>
      {props.items.map((item) => (
        <li key={item.id} class="noto-plugin-sidebar-item">
          <PluginErrorBoundary label={item.title}>
            <button
              type="button"
              class="noto-plugin-button noto-plugin-button-icon"
              title={item.title}
              aria-label={item.title}
              onClick={() => item.onSelect()}
            >
              {item.icon ? (
                <span class="noto-plugin-icon" aria-hidden="true">
                  <Icon name={item.icon} size={16} />
                </span>
              ) : null}
              <span class="noto-plugin-label">{item.title}</span>
            </button>
          </PluginErrorBoundary>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------------- toolbar */

export interface PluginToolbarSlotProps {
  items: PluginToolbarItem[];
}

/**
 * The buttons the plugins added to the editor toolbar.
 *
 * The buttons are icon-only: the name of the action stays in the `aria-label`
 * and in the tooltip of the button.
 */
export function PluginToolbarSlot(props: PluginToolbarSlotProps) {
  const t = useT();
  if (props.items.length === 0) return null;
  return (
    <div class="noto-plugin-toolbar" role="toolbar" aria-label={t('plugins.actionsLabel')}>
      {props.items.map((item) => (
        <PluginErrorBoundary key={item.id} label={item.title}>
          <button
            type="button"
            class="noto-plugin-button noto-plugin-button-icon"
            title={item.title}
            aria-label={item.title}
            onClick={() => {
              void item.run();
            }}
          >
            {item.icon ? (
              <span class="noto-plugin-icon" aria-hidden="true">
                <Icon name={item.icon} size={16} />
              </span>
            ) : null}
            <span class="noto-plugin-label">{item.title}</span>
          </button>
        </PluginErrorBoundary>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- context menu */

export interface PluginContextMenuSlotProps {
  items: PluginContextMenuItem[];
  /** The path of the file the menu belongs to. */
  path: string;
}

/** The context menu entries the plugins added for a file. */
export function PluginContextMenuSlot(props: PluginContextMenuSlotProps) {
  const t = useT();
  const applicable = props.items.filter((item) => {
    try {
      return item.appliesTo(props.path);
    } catch {
      return false;
    }
  });
  if (applicable.length === 0) return null;
  return (
    <ul class="noto-plugin-context-menu" role="menu" aria-label={t('plugins.actionsLabel')}>
      {applicable.map((item) => (
        <li key={item.id} role="none">
          <PluginErrorBoundary label={item.title}>
            <button
              type="button"
              role="menuitem"
              class="noto-plugin-button"
              title={item.title}
              aria-label={item.title}
              onClick={() => {
                void item.run(props.path);
              }}
            >
              {item.title}
            </button>
          </PluginErrorBoundary>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- commands */

export interface PluginCommandSlotProps {
  commands: PluginCommand[];
}

/** The commands the plugins registered (used by the command palette). */
export function PluginCommandSlot(props: PluginCommandSlotProps) {
  const t = useT();
  if (props.commands.length === 0) return null;
  return (
    <ul class="noto-plugin-commands" role="list" aria-label={t('plugins.commandsLabel')}>
      {props.commands.map((command) => (
        <li key={command.id} class="noto-plugin-command">
          <PluginErrorBoundary label={command.title}>
            <button
              type="button"
              class="noto-plugin-button"
              title={command.description ?? command.title}
              aria-label={command.title}
              onClick={() => {
                void command.run();
              }}
            >
              <span class="noto-plugin-label">{command.title}</span>
              {command.shortcut ? (
                <kbd class="noto-plugin-shortcut">{command.shortcut}</kbd>
              ) : null}
            </button>
          </PluginErrorBoundary>
        </li>
      ))}
    </ul>
  );
}
