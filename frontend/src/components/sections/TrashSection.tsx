// The trash section of the left column.
//
// The section shows the notes that were deleted and that can still be restored.
// The dialog of the trash shows the same list; the section is the permanent
// place, the dialog is the shortcut.
import { TrashList } from '../TrashList';

export interface TrashSectionProps {
  /** Called after a note was restored. */
  onRestored?(): void;
}

export function TrashSection(props: TrashSectionProps) {
  return (
    <section class="column-section" aria-label="Trash">
      <header class="column-header section-header">
        <span class="section-header-title">Trash</span>
      </header>
      <div class="column-body">
        <TrashList onRestored={props.onRestored} />
      </div>
    </section>
  );
}
