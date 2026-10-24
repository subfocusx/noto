// The history section of the left column.
//
// The section shows what happened before: the notes that were opened recently
// and the versions of the notes.
//
// The storage keeps only the current revision of a note, so there is no version
// to show yet. The block says so instead of pretending that the history exists:
// a feature that is not there must not look like a feature that is broken.
import { RecentNotesPanel } from '../RecentNotesPanel';

export interface HistorySectionProps {
  /** The paths of the recently opened notes, the most recent first. */
  recentPaths: string[];
  /** The paths that currently exist in the tree. */
  knownPaths: string[];
  /** Called when a note of the list is opened. */
  onOpen(path: string): void;
  /** Called when a note is removed from the list. */
  onRemove(path: string): void;
  /** True when the list of the recent notes is collapsed. */
  recentCollapsed?: boolean;
  /** Called when the user folds or unfolds the list of the recent notes. */
  onToggleRecent?(): void;
}

export function HistorySection(props: HistorySectionProps) {
  return (
    <section class="column-section" aria-label="History">
      <header class="column-header section-header">
        <span class="section-header-title">History</span>
      </header>
      <div class="column-body">
        {props.recentPaths.length > 0 ? (
          <RecentNotesPanel
            paths={props.recentPaths}
            knownPaths={props.knownPaths}
            collapsed={props.recentCollapsed}
            onToggleCollapsed={props.onToggleRecent}
            onOpen={props.onOpen}
            onRemove={props.onRemove}
          />
        ) : (
          <p class="section-hint">
            No note was opened yet. The notes you open are listed here.
          </p>
        )}

        <div class="sidebar-section">
          <div class="sidebar-section-title">
            <span>Versions</span>
          </div>
          <p class="section-hint">
            The storage keeps only the current revision of a note: there is no version to show
            yet.
          </p>
        </div>
      </div>
    </section>
  );
}
