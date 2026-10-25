// The dialog of a conflict.
//
// The note on the server is not the note of the editor: the note was changed
// outside of the application (another editor, another tab, a script). The
// dialog does not decide for the user — it shows both versions and offers the
// three ways out.
import { Icon } from '../ui/icons';
import type { NoteConflict } from '../core/store/types';
import { useT } from '../i18n/useT';

export interface NoteConflictDialogProps {
  /** The conflict of the note (`null` when there is none). */
  conflict: NoteConflict | null;
  /** The text of the editor, the version of the user. */
  localContent: string;
  /** Takes the version of the server. */
  onReload(): void;
  /** Writes the version of the editor over the version of the server. */
  onKeepMine(): void;
  /** Copies the version of the editor to the clipboard. */
  onCopyMine(): void;
  /** Closes the dialog without changing anything. */
  onDismiss(): void;
}

/**
 * The dialog of the conflict.
 *
 * The dialog is modal: the note behind it stays readable, but the user has to
 * decide first, so the autosave of that note waits.
 */
export function NoteConflictDialog(props: NoteConflictDialogProps) {
  const t = useT();
  const conflict = props.conflict;
  if (!conflict) return null;

  const when = conflict.serverUpdatedAt
    ? new Date(conflict.serverUpdatedAt).toLocaleString()
    : t('conflict.unknownMoment');

  return (
    <div class="q9-conflict-backdrop" role="presentation">
      <div
        class="q9-conflict"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="noto-conflict-title"
        data-testid="note-conflict"
      >
        <h2 id="noto-conflict-title" class="q9-conflict-title">
          <Icon name="refresh-cw" size={16} />
          {t('conflict.title')}
        </h2>
        <p class="q9-conflict-text">
          {t('conflict.text', {
            when,
            revision: conflict.serverRevision,
          })}
        </p>
        <div class="q9-conflict-actions">
          <button type="button" class="q9-button" onClick={props.onReload}>
            {t('conflict.takeServer')}
          </button>
          <button type="button" class="q9-button" onClick={props.onKeepMine}>
            {t('conflict.keepMine')}
          </button>
          <button type="button" class="q9-button" onClick={props.onCopyMine}>
            {t('conflict.copyMine')}
          </button>
          <button type="button" class="q9-button q9-button-quiet" onClick={props.onDismiss}>
            {t('conflict.later')}
          </button>
        </div>
        <details class="q9-conflict-details">
          <summary>{t('conflict.showServer')}</summary>
          <pre class="q9-conflict-preview">{conflict.serverContent}</pre>
        </details>
      </div>
    </div>
  );
}
