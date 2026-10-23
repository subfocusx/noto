// The dialogs of the notes: create, rename, move, delete and the recovery of
// a local draft.
//
// The dialogs share the `Dialog` primitive; they only differ by their title,
// their content and their buttons. The accessible names are part of the
// contract of the application: the title of the dialog, the label `Name` of
// the inputs and the names `OK` and `Delete` of the confirm buttons.
import type { DialogState } from '../core/store/types';
import type { Draft } from '../lib/drafts';
import { Dialog } from './Dialog';

interface NoteDialogsProps {
  /** The dialog the shell has opened. */
  dialog: DialogState;
  /** The paths of the folders, used by the "move" dialog. */
  folderPaths: string[];
  /** The local draft the user can restore, if any. */
  draftOffer: Draft | null;
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
}

/** The title of the dialog of the given kind. */
function dialogTitle(kind: DialogState['kind']): string {
  if (kind === 'create-folder') return 'New folder';
  if (kind === 'create-file') return 'New note';
  if (kind === 'rename') return 'Rename';
  if (kind === 'move') return 'Move';
  return 'Delete';
}

/** True when the dialog asks for a name. */
function asksForName(kind: DialogState['kind']): boolean {
  return kind === 'create-folder' || kind === 'create-file' || kind === 'rename';
}

/** The create/rename/move/delete dialog and the draft recovery dialog. */
export function NoteDialogs(props: NoteDialogsProps) {
  const kind = props.dialog.kind;
  const open =
    kind === 'create-folder' ||
    kind === 'create-file' ||
    kind === 'rename' ||
    kind === 'move' ||
    kind === 'delete';
  const name = props.dialog.value ?? '';
  const empty = asksForName(kind) && name.trim() === '';

  return (
    <>
      <Dialog
        title={dialogTitle(kind)}
        open={open}
        onClose={props.onClose}
        footer={
          <div class="button-row">
            <button type="button" class="text-button" onClick={props.onClose}>
              Cancel
            </button>
            <button type="button" class="primary-button" onClick={props.onConfirm}>
              {kind === 'delete' ? 'Delete' : 'OK'}
            </button>
          </div>
        }
      >
        {kind === 'move' ? (
          <div class="field">
            <label for="noto-note-target">Target folder</label>
            <select
              id="noto-note-target"
              value={name}
              onChange={(event) => props.onChangeValue((event.target as HTMLSelectElement).value)}
            >
              <option value="">(root)</option>
              {props.folderPaths.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
            <span class="field-hint">The folder the note is moved into.</span>
          </div>
        ) : kind === 'delete' ? (
          <>
            <p>
              Delete <strong>{props.dialog.node?.name}</strong>? It can be restored from the trash.
            </p>
            <p class="dialog-hint">The note is moved into the trash, not erased for good.</p>
          </>
        ) : (
          <div class="field">
            <label for="noto-note-name">Name</label>
            <input
              id="noto-note-name"
              type="text"
              aria-label="Name"
              aria-invalid={empty ? 'true' : undefined}
              value={name}
              onInput={(event) => props.onChangeValue((event.target as HTMLInputElement).value)}
            />
            {empty ? <span class="field-error">The name must not be empty.</span> : null}
          </div>
        )}
      </Dialog>

      <Dialog
        title="Recover local draft?"
        open={props.draftOffer !== null}
        onClose={props.onClose}
        footer={
          <div class="button-row">
            <button type="button" class="text-button" onClick={props.onDiscardDraft}>
              Discard
            </button>
            <button type="button" class="primary-button" onClick={props.onRestoreDraft}>
              Restore
            </button>
          </div>
        }
      >
        <p>
          A newer unsaved local version of <strong>{props.draftOffer?.path}</strong> exists. Restore
          it?
        </p>
        <p class="dialog-hint">Discarding the draft keeps the version that is stored on the server.</p>
      </Dialog>
    </>
  );
}
