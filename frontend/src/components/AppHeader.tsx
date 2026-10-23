import type { ComponentChildren } from 'preact';
import { Icon } from '../ui/icons';

export interface AppHeaderProps {
  /** The name of the open note, or `Noto` when no note is open. */
  title: string;
  /** The name of the vault; shown in the title of the brand. */
  vaultName?: string;
  /** False when the application works offline. */
  online?: boolean;
  /** Extra controls of the column. */
  children?: ComponentChildren;
}

/**
 * The header of the left column.
 *
 * The top bar of the application was dismantled: its actions live in the
 * status bar at the bottom of the window. What is left here is a compact
 * block with the brand, the state of the sync and the name of the open note.
 */
export function AppHeader(props: AppHeaderProps) {
  const online = props.online !== false;
  return (
    <header class="app-header app-header-compact">
      <div class="app-brand">
        <span class="app-brand-mark" aria-hidden="true">
          <Icon name="file-text" size={15} />
        </span>
        <span class="app-brand-name" title={props.vaultName ? `Vault: ${props.vaultName}` : 'Noto'}>
          Noto
        </span>
        <span
          class="app-brand-meta"
          title={online ? 'The vault is in sync' : 'The vault is offline'}
          aria-label={online ? 'Synced' : 'Offline'}
          role="img"
        >
          <Icon name={online ? 'refresh-cw' : 'circle'} size={11} />
        </span>
      </div>

      <span class="app-title">{props.title}</span>

      {props.children}
    </header>
  );
}
