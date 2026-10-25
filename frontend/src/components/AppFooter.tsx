import type { AutosaveStatus } from '../lib/autosave';
import type { ConnectionState } from '../types';
import { useT } from '../i18n/useT';
import { IconButton } from '../ui/tooltip';
import { ConnectionIndicator } from './ConnectionIndicator';

export interface AppFooterProps {
  /** The message of the last save error, if any. */
  saveError: string | null;
  /**
   * The state of the connection with the backend.
   *
   * The bar always shows the dot, so the state is always known.
   */
  connection: ConnectionState;
  /** Called when the user asks the application to check the backend again. */
  onRetryConnection?(): void;
  /** The state of the autosave. */
  status: AutosaveStatus;
  /** The readable label of the state of the autosave. */
  statusLabel?: string;
  /** Opens or closes the navigation drawer of a narrow screen. */
  onToggleDrawer?(): void;
  /** True when the drawer of a narrow screen is open. */
  drawerOpen?: boolean;
  /** The path of the open note. */
  currentPath: string;
  /** Tries to save the note again. */
  onRetrySave(): void;
  /** The number of words of the open note. */
  wordCount?: number;
  /** The number of characters of the open note. */
  characterCount?: number;
  /** The position of the cursor in the open note. */
  cursor?: { line: number; column: number } | null;
  /** The encoding of the file; `UTF-8` by default. */
  encoding?: string;
  /** False when the note cannot be written. */
  writable?: boolean;
  /** The path of the vault; shown in the title of the path. */
  vaultPath?: string;
  /** Shows or hides the right column (the outline of the note). */
  onTogglePanel?(): void;
  /** True when the right column is visible. */
  panelVisible?: boolean;
  /** Switches between the light and the dark theme. */
  onToggleTheme?(): void;
  /** The theme that is really active. */
  theme?: 'light' | 'dark';
  /**
   * The text of the query that filters the tree, when one is active.
   *
   * The bar is permanent, so the state of the filter is always known: the user
   * sees that the tree shows only the matching notes, and can drop the filter.
   */
  filterQuery?: string | null;
  /** The number of the notes that match the query. */
  filterTotal?: number;
  /**
   * True when the tree holds fewer notes than the counter.
   *
   * The answer of a query is limited to the first fifty matches, while the
   * counter tells the whole number: the chip says so.
   */
  filterTruncated?: boolean;
  /** Drops the filter and shows the whole tree again. */
  onClearFilter?(): void;
}

/** Groups the digits of a number with a thin space: `1 248`. */
function group(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * The status bar of the application.
 *
 * The bar is permanent: it holds the toggles of the columns, so a hidden
 * column can always be opened again, and the state of the document: the path
 * of the note, the position of the cursor, the counters and the format. The
 * actions of the vault live in the header of the explorer, not here.
 *
 * The state of the backend stands next to the state of the save: the dot of
 * the connection is a button, and a click asks the application to check the
 * backend again.
 *
 * The left column has no toggle: the rail of the sections is always there, and
 * the column stands next to it.
 */
export function AppFooter(props: AppFooterProps) {
  const t = useT();
  return (
    <footer class="app-footer">
      <div class="app-footer-actions" role="group" aria-label={t('footer.globalActions')}>
        <IconButton
          label={t('footer.toggleNavigation')}
          icon="menu"
          class="menu-button"
          pressed={props.drawerOpen}
          onClick={() => props.onToggleDrawer?.()}
        />
        <IconButton
          label={t('footer.toggleOutline')}
          icon="panel-right"
          pressed={props.panelVisible}
          onClick={() => props.onTogglePanel?.()}
        />
        <IconButton
          label={t('footer.toggleTheme')}
          icon={props.theme === 'dark' ? 'sun' : 'moon'}
          onClick={() => props.onToggleTheme?.()}
        />
      </div>
      {props.saveError ? (
        <span class="error-text" role="alert">
          {props.saveError}
        </span>
      ) : null}
      {props.statusLabel ? (
        <span class={`status status-${props.status}`} data-testid="save-status" role="status">
          {props.statusLabel}
        </span>
      ) : null}
      {props.status === 'error' ? (
        <button type="button" class="text-button" onClick={props.onRetrySave}>
          {t('footer.retrySave')}
        </button>
      ) : null}
      <ConnectionIndicator connection={props.connection} onRetry={props.onRetryConnection} />
      <span class="muted" title={props.vaultPath ?? props.currentPath}>
        {props.currentPath}
      </span>
      {props.filterQuery ? (
        <span class="filter-chip" data-testid="filter-chip">
          <span class="filter-chip-name">{t('footer.filterLabel', { query: props.filterQuery })}</span>
          {props.filterTotal !== undefined ? (
            <span
              class="filter-chip-count"
              title={props.filterTruncated ? t('footer.filterTruncated') : undefined}
            >
              {props.filterTotal === 1
                ? t('footer.oneNote', { count: props.filterTotal })
                : t('footer.manyNotes', { count: props.filterTotal })}
            </span>
          ) : null}
          <IconButton
            label={t('footer.clearFilter')}
            icon="x"
            size={12}
            class="filter-chip-x"
            onClick={() => props.onClearFilter?.()}
          />
        </span>
      ) : null}
      <span class="app-footer-spacer" />
      {props.cursor ? (
        <span class="tabular app-footer-cursor">
          {t('footer.cursor', { line: props.cursor.line, column: props.cursor.column })}
        </span>
      ) : null}
      {props.wordCount !== undefined ? (
        <span class="tabular">{t('footer.words', { count: group(props.wordCount) })}</span>
      ) : null}
      {props.characterCount !== undefined ? (
        <span class="tabular">{t('footer.chars', { count: group(props.characterCount) })}</span>
      ) : null}
      <span class="tabular app-footer-format">{t('footer.markdown')}</span>
      <span class="tabular app-footer-format">{props.encoding ?? 'UTF-8'}</span>
      <span class="tabular">
        {props.writable === false ? t('footer.readOnly') : t('footer.writable')}
      </span>
    </footer>
  );
}
