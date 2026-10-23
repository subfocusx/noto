import type { ViewMode } from '../core/store/types';
import type { AutosaveStatus } from '../lib/autosave';

interface AppHeaderProps {
  title: string;
  status: AutosaveStatus;
  statusLabel: string;
  mode: ViewMode;
  drawerOpen: boolean;
  theme: 'light' | 'dark';
  onToggleDrawer(): void;
  onSetMode(mode: ViewMode): void;
  onToggleTheme(): void;
  onOpenAttachments(): void;
}

/** The application header: navigation toggle, title, save status and modes. */
export function AppHeader(props: AppHeaderProps) {
  return (
    <header class="app-header">
      <button
        type="button"
        class="icon-button menu-button"
        aria-label="Toggle navigation"
        aria-expanded={props.drawerOpen}
        onClick={props.onToggleDrawer}
      >
        ☰
      </button>
      <span class="app-title">{props.title}</span>
      <div class="app-header-actions">
        <span class={`status status-${props.status}`} data-testid="save-status" role="status">
          {props.statusLabel}
        </span>
        <div class="mode-switch" role="group" aria-label="View mode">
          {(['editor', 'split', 'preview'] as ViewMode[]).map((m) => (
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
          {props.theme === 'dark' ? '☾' : '☀'}
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="Attachments"
          title="Attachments"
          onClick={props.onOpenAttachments}
        >
          🖼
        </button>
      </div>
    </header>
  );
}
