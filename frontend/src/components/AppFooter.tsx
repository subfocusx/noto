import type { AutosaveStatus } from '../lib/autosave';

interface AppFooterProps {
  saveError: string | null;
  status: AutosaveStatus;
  currentPath: string;
  onRetrySave(): void;
}

/** The application footer: save errors and the path of the open note. */
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
      <span class="muted">{props.currentPath}</span>
    </footer>
  );
}
