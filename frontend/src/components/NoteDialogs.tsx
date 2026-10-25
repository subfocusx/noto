// The dialogs of the notes: create, rename, move, delete and the recovery of
// a local draft.
//
// The dialogs share the `Dialog` primitive; they only differ by their title,
// their content and their buttons. The accessible names are part of the
// contract of the application: the title of the dialog, the label `Name` of
// the inputs and the names `OK` and `Delete` of the confirm buttons.
import { useEffect, useState } from 'preact/hooks';
import type { DialogState } from '../core/store/types';
import { asksForName as dialogAsksForName } from '../core/store/types';
import type { UndoDeleteOffer } from '../core/editor/undoDelete';
import type { Draft } from '../lib/drafts';
import { useT, type Translator } from '../i18n/useT';
import { Dialog } from './Dialog';

interface NoteDialogsProps {
  /** The dialog the shell has opened. */
  dialog: DialogState;
  /** The paths of the folders, used by the "move" dialog. */
  folderPaths: string[];
  /** The local draft the user can restore, if any. */
  draftOffer: Draft | null;
  /** The deletion that can be undone, if any. */
  undoOffer?: UndoDeleteOffer | null;
  /** Called when the dialog is closed without a change. */
  onClose(): void;
  /** Called when the dialog is confirmed. */
  onConfirm(): void;
  /** Called when the value of the dialog changes. */
  onChangeValue(value: string): void;
  /** Called when the local draft is restored. */
  onRestoreDraft(): void;
  /** Called when the local draft is thrown away. */
  onDiscardDraft(): void;
  /**
   * Called when the draft is reset to the version of the server.
   *
   * The callback is optional: the shell wires it when the store is ready.
   */
  onResetDraft?(): void;
  /** Called when the deleted note is restored. */
  onUndoDelete?(): void;
  /** Called when the offer of the undo is thrown away. */
  onDismissUndo?(): void;
}

/** The title of the dialog of the given kind. */
function dialogTitle(kind: DialogState['kind'], t: Translator): string {
  if (kind === 'create-folder') return t('dialog.createFolder.title');
  if (kind === 'create-file') return t('dialog.createFile.title');
  if (kind === 'rename') return t('dialog.rename.title');
  if (kind === 'move') return t('dialog.move.title');
  return t('dialog.delete.title');
}

/**
 * The placeholder of the field of the name.
 *
 * The placeholder is not a value: the name of a new note or of a new folder
 * is written by the user, never by the application.
 */
function namePlaceholder(kind: DialogState['kind'], t: Translator): string {
  if (kind === 'create-folder') return t('dialog.placeholder.folder');
  if (kind === 'create-file') return t('dialog.placeholder.file');
  return t('dialog.placeholder.other');
}

/** The create/rename/move/delete dialog and the draft recovery dialog. */
export function NoteDialogs(props: NoteDialogsProps) {
  const t = useT();
  const kind = props.dialog.kind;
  const open =
    kind === 'create-folder' ||
    kind === 'create-file' ||
    kind === 'rename' ||
    kind === 'move' ||
    kind === 'delete';
  const name = props.dialog.value ?? '';
  const empty = dialogAsksForName(kind) && name.trim() === '';

  // The warning about an empty name appears when the user has typed (and
  // emptied) the field, not when the dialog has just been opened.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setTouched(false);
  }, [kind]);
  const showError = empty && touched;

  return (
    <>
      <Dialog
        title={dialogTitle(kind, t)}
        open={open}
        onClose={props.onClose}
        footer={
          <div class="button-row">
            <button type="button" class="text-button" onClick={props.onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" class="primary-button" onClick={props.onConfirm}>
              {kind === 'delete' ? t('common.delete') : t('common.ok')}
            </button>
          </div>
        }
      >
        {kind === 'move' ? (
          <div class="field">
            <label for="noto-note-target">{t('dialog.targetFolder')}</label>
            <select
              id="noto-note-target"
              value={name}
              onChange={(event) => props.onChangeValue((event.target as HTMLSelectElement).value)}
            >
              <option value="">{t('dialog.root')}</option>
              {props.folderPaths.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
            <span class="field-hint">{t('dialog.moveHint')}</span>
          </div>
        ) : kind === 'delete' ? (
          <>
            <p>
              {t('dialog.deleteQuestion', { name: props.dialog.node?.name ?? '' })}
            </p>
            <p class="dialog-hint">{t('dialog.deleteHint')}</p>
          </>
        ) : (
          <div class="field">
            <label for="noto-note-name">{t('dialog.nameLabel')}</label>
            <input
              id="noto-note-name"
              type="text"
              aria-label={t('dialog.nameLabel')}
              aria-invalid={showError ? 'true' : undefined}
              placeholder={namePlaceholder(kind, t)}
              value={name}
              onInput={(event) => {
                setTouched(true);
                props.onChangeValue((event.target as HTMLInputElement).value);
              }}
            />
            {showError ? <span class="field-error">{t('dialog.emptyName')}</span> : null}
          </div>
        )}
      </Dialog>

      <Dialog
        title={t('dialog.draft.title')}
        open={props.draftOffer !== null}
        onClose={props.onClose}
        footer={
          <div class="button-row">
            <button type="button" class="text-button" onClick={props.onDiscardDraft}>
              {t('dialog.draft.discard')}
            </button>
            <button
              type="button"
              class="text-button"
              onClick={() => props.onResetDraft?.()}
              title={t('dialog.draft.resetTitle')}
            >
              {t('dialog.draft.reset')}
            </button>
            <button type="button" class="primary-button" onClick={props.onRestoreDraft}>
              {t('dialog.draft.restore')}
            </button>
          </div>
        }
      >
        <p>{t('dialog.draft.question', { path: props.draftOffer?.path ?? '' })}</p>
        <p class="dialog-hint">{t('dialog.draft.hint')}</p>
      </Dialog>

      <UndoDeleteToast
        offer={props.undoOffer ?? null}
        onUndo={() => props.onUndoDelete?.()}
        onDismiss={() => props.onDismissUndo?.()}
      />
    </>
  );
}

/** The toast that offers to undo a deletion. */
export function UndoDeleteToast(props: {
  offer: UndoDeleteOffer | null;
  onUndo(): void;
  onDismiss(): void;
}) {
  const t = useT();
  if (!props.offer) return null;
  return (
    <div class="noto-undo-toast" role="status" data-testid="undo-delete-toast">
      <span class="noto-undo-toast-label">
        {t('dialog.undo.deletedBefore')}{' '}
        <strong>{props.offer.name}</strong>
        {t('dialog.undo.deletedAfter')}
      </span>
      <button type="button" class="noto-undo-toast-button" onClick={props.onUndo}>
        {t('dialog.undo.undo')}
      </button>
    </div>
  );
}
