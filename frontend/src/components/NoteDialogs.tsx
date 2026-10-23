import type { DialogState } from '../core/store/types';
import type { Draft } from '../lib/drafts';
import { Dialog } from './Dialog';

interface NoteDialogsProps {
  dialog: DialogState;
  folderPaths: string[];
  draftOffer: Draft | null;
  onClose(): void;
  onConfirm(): void;
  onChangeValue(value: string): void;
  onRestoreDraft(): void;
  onDiscardDraft(): void;
}

function dialogTitle(kind: DialogState['kind']): string {
  if (kind === 'create-folder') return 'New folder';
  if (kind === 'create-file') return 'New note';
  if (kind === 'rename') return 'Rename';
  if (kind === 'move') return 'Move';
  return 'Delete';
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

  return (
    <>
      <Dialog
        title={dialogTitle(kind)}
        open={open}
        onClose={props.onClose}
        footer={
          <>
            <button type="button" class="text-button" onClick={props.onClose}>
              Cancel
            </button>
            <button type="button" class="primary-button" onClick={props.onConfirm}>
              {kind === 'delete' ? 'Delete' : 'OK'}
            </button>
          </>
        }
      >
        {kind === 'move' ? (
          <label class="field">
            <span>Target folder</span>
            <select
              aria-label="Target folder"
              value={props.dialog.value ?? ''}
              onChange={(e) => props.onChangeValue((e.target as HTMLSelectElement).value)}
            >
              <option value="">(root)</option>
              {props.folderPaths.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </label>
        ) : kind === 'delete' ? (
          <p>
            Delete <strong>{props.dialog.node?.name}</strong>? It can be restored from the trash.
          </p>
        ) : (
          <label class="field">
            <span>Name</span>
            <input
              type="text"
              aria-label="Name"
              value={props.dialog.value ?? ''}
              onInput={(e) => props.onChangeValue((e.target as HTMLInputElement).value)}
            />
          </label>
        )}
      </Dialog>

      <Dialog
        title="Recover local draft?"
        open={props.draftOffer !== null}
        onClose={props.onClose}
        footer={
          <>
            <button type="button" class="text-button" onClick={props.onDiscardDraft}>
              Discard
            </button>
            <button type="button" class="primary-button" onClick={props.onRestoreDraft}>
              Restore
            </button>
          </>
        }
      >
        <p>
          A newer unsaved local version of <strong>{props.draftOffer?.path}</strong> exists. Restore
          it?
        </p>
      </Dialog>
    </>
  );
}
