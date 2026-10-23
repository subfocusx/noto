import type { ViewMode } from '../core/store/types';
import type { AutosaveStatus } from '../lib/autosave';
import { Icon } from '../ui/icons';

interface AppHeaderProps {
  title: string;
  status: AutosaveStatus;
  statusLabel: string;
  mode: ViewMode;
  drawerOpen: boolean;
  /** The theme the user chose; `system` follows the operating system. */
  theme: 'light' | 'dark' | 'system';
  /** The theme that is really active. */
  effectiveTheme?: 'light' | 'dark';
  onToggleDrawer(): void;
  onSetMode(mode: ViewMode): void;
  onToggleTheme(): void;
  onOpenAttachments(): void;
}

/** The view modes of the workspace, in the order they are shown. */
const MODES: ViewMode[] = ['editor', 'split', 'preview'];

/**
 * The application header: navigation toggle, title, save status and modes.
 */
export function AppHeader(props: AppHeaderProps) {
  // Without the effective theme the choice of the user is used: `system`
  // behaves like the light theme until the application reports the real one.
  const effective = props.effectiveTheme ?? (props.theme === 'dark' ? 'dark' : 'light');
  return (
    <header class="app-header">
      <button
        type="button"
        class="icon-button menu-button"
        aria-label="Toggle navigation"
        aria-expanded={props.drawerOpen}
        title="Toggle navigation"
        onClick={props.onToggleDrawer}
      >
        <Icon name="menu" size={16} />
      </button>
      <span class="app-title">{props.title}</span>
      <div class="app-header-actions">
        <span class={`status status-${props.status}`} data-testid="save-status" role="status">
          {props.statusLabel}
        </span>
        <div class="mode-switch" role="group" aria-label="View mode">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              class={props.mode === m ? 'active' : ''}
              aria-pressed={props.mode === m}
              onClick={() => props.onSetMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label="Toggle theme"
          title="Toggle theme"
          onClick={props.onToggleTheme}
        >
          <Icon name={effective === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="Attachments"
          title="Attachments"
          onClick={props.onOpenAttachments}
        >
          <Icon name="image" size={16} />
        </button>
      </div>
    </header>
  );
}
