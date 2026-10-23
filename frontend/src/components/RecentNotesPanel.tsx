// The list of the recently opened notes.
//
// The panel shows the last notes the user opened. A note that was deleted in
// the meantime is still listed, but it is marked as missing.
import { Icon } from '../ui/icons';

export interface RecentNotesPanelProps {
  /** The paths of the recent notes, the most recent first. */
  paths: string[];
  /** Called when a note of the list is opened. */
  onOpen(path: string): void;
  /** Called when a note is removed from the list. */
  onRemove(path: string): void;
  /** The paths that currently exist in the tree. */
  knownPaths: string[];
}

/** The name of a note: the last segment of its path. */
function nameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

export function RecentNotesPanel(props: RecentNotesPanelProps) {
  if (props.paths.length === 0) return null;

  const known = new Set(props.knownPaths);

  return (
    <section class="sidebar-section" aria-label="Recent notes">
      <h2 class="sidebar-section-title">Recent</h2>
      <ul class="recent-list">
        {props.paths.map((path) => {
          const name = nameOf(path);
          const missing = !known.has(path);
          return (
            <li
              key={path}
              class="recent-row"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
            >
              <button
                type="button"
                class={`recent-item${missing ? ' missing' : ''}`}
                title={path}
                style={{ flex: '1', minWidth: 0 }}
                onClick={() => props.onOpen(path)}
              >
                <span class="tree-icon">
                  <Icon name="file-text" size={14} />
                </span>
                <span class="recent-name">{name}</span>
              </button>
              <button
                type="button"
                class="icon-button"
                title={`Remove ${name}`}
                aria-label={`Remove ${name}`}
                onClick={() => props.onRemove(path)}
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
