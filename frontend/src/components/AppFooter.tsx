import type { AutosaveStatus } from '../lib/autosave';

export interface AppFooterProps {
  /** The message of the last save error, if any. */
  saveError: string | null;
  /** The state of the autosave. */
  status: AutosaveStatus;
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
 * The left side shows the path of the open note, the right side the state of
 * the document: the position of the cursor, the counters and the format.
 */
export function AppFooter(props: AppFooterProps) {
  return (
    <footer class="app-footer">
      {props.saveError ? (
        <span class="error-text" role="alert">
          {props.saveError}
        </span>
      ) : null}
      {props.status === 'error' ? (
        <button type="button" class="text-button" onClick={props.onRetrySave}>
          Retry save
        </button>
      ) : null}
      <span class="muted" title={props.vaultPath ?? props.currentPath}>
        {props.currentPath}
      </span>
      <span class="app-footer-spacer" />
      {props.cursor ? (
        <span class="tabular">
          Ln {props.cursor.line}, Col {props.cursor.column}
        </span>
      ) : null}
      {props.wordCount !== undefined ? (
        <span class="tabular">{group(props.wordCount)} words</span>
      ) : null}
      {props.characterCount !== undefined ? (
        <span class="tabular">{group(props.characterCount)} chars</span>
      ) : null}
      <span class="tabular">Markdown</span>
      <span class="tabular">{props.encoding ?? 'UTF-8'}</span>
      <span class="tabular">{props.writable === false ? 'Read only' : 'Writable'}</span>
    </footer>
  );
}
