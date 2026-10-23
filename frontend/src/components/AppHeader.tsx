import type { ViewMode } from '../core/store/types';
import type { AutosaveStatus } from '../lib/autosave';
import { Icon } from '../ui/icons';

export interface AppHeaderProps {
  /** The name of the open note, or `Noto` when no note is open. */
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
  /** Opens the search palette. */
  onOpenSearch?(): void;
  /** Shows or hides the left column (the vault and the tree of the notes). */
  onToggleSidebar?(): void;
  /** Shows or hides the right column (the outline of the note). */
  onTogglePanel?(): void;
  /** True when the left column is visible. */
  sidebarVisible?: boolean;
  /** True when the right column is visible. */
  panelVisible?: boolean;
  /** The name of the vault; shown in the title of the brand. */
  vaultName?: string;
  /** False when the application works offline. */
  online?: boolean;
}

/** The view modes of the workspace, in the order they are shown. */
const MODES: ViewMode[] = ['editor', 'split', 'preview'];

/**
 * The top bar of the application.
 *
 * The bar is persistent: it always shows the brand, the search field, the
 * navigation, the state of the autosave and the actions. The two buttons that
 * show the left and the right column live here, so a collapsed column can
 * always be opened again.
 */
export function AppHeader(props: AppHeaderProps) {
  // Without the effective theme the choice of the user is used: `system`
  // behaves like the light theme until the application reports the real one.
  const effective = props.effectiveTheme ?? (props.theme === 'dark' ? 'dark' : 'light');
  const online = props.online !== false;
  return (
    <header class="app-header">
      <div class="app-brand">
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
        <span class="app-brand-mark" aria-hidden="true">
          <Icon name="file-text" size={15} />
        </span>
        <span class="app-brand-name" title={props.vaultName ? `Vault: ${props.vaultName}` : 'Noto'}>
          Noto
        </span>
        <span class="app-brand-meta" title={online ? 'The vault is in sync' : 'The vault is offline'}>
          <Icon name={online ? 'refresh-cw' : 'circle'} size={11} />
          {online ? 'Synced' : 'Offline'}
        </span>
      </div>

      <span class="app-title">{props.title}</span>

      <div class="app-header-search">
        <input
          type="search"
          readOnly
          aria-label="Search notes"
          placeholder="Search notes, tags, or commands..."
          onClick={() => props.onOpenSearch?.()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') props.onOpenSearch?.();
          }}
        />
        <span class="search-hint" aria-hidden="true">
          Ctrl K
        </span>
      </div>

      <div class="app-header-nav">
        <button type="button" class="active" aria-current="page" title="Editor">
          Editor
        </button>
        <button type="button" aria-disabled="true" title="Not implemented yet">
          Graph
        </button>
        <button type="button" aria-disabled="true" title="Not implemented yet">
          Archive
        </button>
      </div>

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
        <button
          type="button"
          class="icon-button"
          aria-label="Toggle notes panel"
          title="Toggle notes panel"
          aria-pressed={props.sidebarVisible ?? true}
          onClick={() => props.onToggleSidebar?.()}
        >
          <Icon name="panel-right" size={16} />
        </button>
        <button
          type="button"
          class="icon-button"
          aria-label="Toggle outline panel"
          title="Toggle outline panel"
          aria-pressed={props.panelVisible ?? true}
          onClick={() => props.onTogglePanel?.()}
        >
          <Icon name="file-text" size={16} />
        </button>
      </div>
    </header>
  );
}
