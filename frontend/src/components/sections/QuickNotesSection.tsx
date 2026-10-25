// The quick notes.
//
// A quick note is a note the user starts without naming it: one command
// creates it at the root of the vault, and the user renames it later, when she
// knows what she wants to write.
//
// The list is computed by `core/quicknotes/quickNotes.ts`, which is pure.
import type { Node } from '../../types';
import { quickNotes } from '../../core/quicknotes/quickNotes';
import { useT } from '../../i18n/useT';
import { Icon } from '../../ui/icons';
import '../../styles/panel-quick-notes.css';

export interface QuickNotesSectionProps {
  /** The notes of the vault. */
  files: Node[];
  /** Called when the user opens a quick note. */
  onOpenNote(path: string): void;
  /** Called when the user renames a quick note. */
  onRename(node: Node): void;
  /** Called when the user asks for a new quick note. */
  onCreate(): void;
}

/**
 * The section of the quick notes.
 */
export function QuickNotesSection(props: QuickNotesSectionProps) {
  const t = useT();
  const notes = quickNotes(props.files);

  return (
    <div class="quick-notes">
      <div class="quick-notes-header">
        <span class="quick-notes-title">{t('quickNotes.title')}</span>
        <button
          type="button"
          class="icon-button"
          title={t('quickNotes.new')}
          aria-label={t('quickNotes.new')}
          onClick={() => props.onCreate()}
        >
          <Icon name="file-plus" size={14} />
        </button>
      </div>

      {notes.length === 0 ? (
        <p class="quick-notes-empty">{t('quickNotes.empty')}</p>
      ) : (
        <ul class="quick-notes-list">
          {notes.map((note) => (
            <li key={note.path} class="quick-note">
              <button
                type="button"
                class="quick-note-name"
                onClick={() => props.onOpenNote(note.path)}
                title={note.path}
              >
                {note.name}
              </button>
              <button
                type="button"
                class="icon-button"
                title={t('quickNotes.rename')}
                aria-label={t('tree.renameLabel', { name: note.name })}
                onClick={() => props.onRename(note)}
              >
                <Icon name="pencil" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
