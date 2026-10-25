// The archive of the notes.
//
// The archive holds the notes the tree cannot show: the notes whose folder is
// not in the vault any more. They are still there, with their content, and the
// user can open them, rename them or delete them from here.
//
// The list is computed by `core/views/archive.ts`, which is pure.
import type { Node } from '../../types';
import { archiveNotes } from '../../core/views/archive';
import { useT } from '../../i18n/useT';
import { Icon } from '../../ui/icons';
import '../../styles/archive.css';

export interface ArchivePanelProps {
  /** The notes of the vault. */
  files: Node[];
  /** The folders of the vault. */
  folders: Node[];
  /** Called when the user opens a note of the archive. */
  onOpenNote(path: string): void;
  /** Called when the user renames a note of the archive. */
  onRename(node: Node): void;
  /** Called when the user deletes a note of the archive. */
  onDelete(node: Node): void;
  /** Called when the user closes the panel. */
  onClose?(): void;
}

/**
 * The archive of the notes of the vault.
 */
export function ArchivePanel(props: ArchivePanelProps) {
  const t = useT();
  const notes = archiveNotes(props.files, props.folders);

  return (
    <div class="archive-panel">
      <div class="archive-header">
        <span class="archive-title">{t('archive.title')}</span>
        {props.onClose ? (
          <button
            type="button"
            class="icon-button"
            title={t('archive.close')}
            aria-label={t('archive.close')}
            onClick={() => props.onClose?.()}
          >
            <Icon name="x" size={15} />
          </button>
        ) : null}
      </div>

      {notes.length === 0 ? (
        <p class="archive-empty">{t('archive.empty')}</p>
      ) : (
        <ul class="archive-list">
          {notes.map((note) => (
            <li key={note.path} class="archive-item">
              <button
                type="button"
                class="archive-name"
                onClick={() => props.onOpenNote(note.path)}
                title={note.path}
              >
                {note.name}
              </button>
              <span class="archive-path">{note.path}</span>
              <span class="archive-actions">
                <button
                  type="button"
                  class="icon-button"
                  title={t('archive.rename')}
                  aria-label={t('tree.renameLabel', { name: note.name })}
                  onClick={() => props.onRename(note)}
                >
                  <Icon name="pencil" size={14} />
                </button>
                <button
                  type="button"
                  class="icon-button"
                  title={t('archive.delete')}
                  aria-label={t('archive.deleteNote', { name: note.name })}
                  onClick={() => props.onDelete(note)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
