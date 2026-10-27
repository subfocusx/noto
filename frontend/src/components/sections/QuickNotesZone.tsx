// The zone of the quick notes, above the tree of the vault.
//
// A quick note is a note the user starts without naming it: one command
// creates it at the root of the vault, and the user renames it later, when
// she knows what she wants to write.
//
// The zone stands above the tree and not inside it: a quick note is a
// scratch, not a place in the structure of the vault. The two have different
// lifetimes, so they get different zones and a line between them.
import { useState } from 'preact/hooks';
import type { Node } from '../../types';
import { useT } from '../../i18n/useT';
import { Icon } from '../../ui/icons';
import { TreeNoteRow, type TreeDragState } from '../TreeRow';
import '../../styles/tree-zones.css';

export interface QuickNotesZoneProps {
  /** The quick notes of the vault. */
  notes: Node[];
  /** The path of the note that is open in the editor. */
  currentPath: string;
  /** Called when the user opens a quick note. */
  onOpenNote(path: string): void;
  /** Called when the user asks for the menu of a row. */
  onContextMenu?(payload: import('../TreeContextMenu').TreeContextMenuPayload): void;
  /** Called when a row is renamed in place. */
  onRenameInline?(node: Node, name: string): void | Promise<void>;
  /** The node that is currently dragged, if any. */
  draggingNode?: Node | null;
  /** Called when a drag starts. */
  onDragStart?(state: TreeDragState): void;
  /** Called when a drag ends. */
  onDragEnd?(): void;
  /** Called when the user asks for a new quick note. */
  onCreate(): void;
}

/**
 * The zone of the quick notes.
 *
 * The zone has a head of its own: the name of the zone, the number of the
 * notes it holds and the command that creates a new one. The head is the
 * only place where a quick note is created from, so the action is never
 * duplicated.
 */
export function QuickNotesZone(props: QuickNotesZoneProps) {
  const t = useT();
  // The zone starts open: the quick notes are a way into the application,
  // and a hidden zone is a hidden feature.
  const [open, setOpen] = useState(true);
  const count = props.notes.length;

  return (
    <section class="tree-zone tree-zone-quick" aria-label={t('quickNotes.title')}>
      <div class="tree-zone-head">
        <button
          type="button"
          class="tree-zone-toggle"
          aria-expanded={open}
          aria-label={open ? t('quickNotes.hide') : t('quickNotes.show')}
          title={open ? t('quickNotes.hide') : t('quickNotes.show')}
          onClick={() => setOpen(!open)}
        >
          <span class="tree-zone-chevron">
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          </span>
          <span class="tree-zone-label">{t('quickNotes.title')}</span>
        </button>
        {count > 0 ? <span class="tree-zone-count">{count}</span> : null}
        <button
          type="button"
          class="icon-button tree-zone-action"
          title={t('quickNotes.new')}
          aria-label={t('quickNotes.new')}
          onClick={() => props.onCreate()}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      {open && count > 0 ? (
        <ul class="tree-zone-list">
          {props.notes.map((note) => (
            <TreeNoteRow
              key={note.path}
              file={note}
              currentPath={props.currentPath}
              depth={0}
              onSelect={props.onOpenNote}
              onContextMenu={props.onContextMenu}
              onRenameInline={props.onRenameInline}
              draggingNode={props.draggingNode}
              onDragStart={props.onDragStart}
              onDragEnd={props.onDragEnd}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
