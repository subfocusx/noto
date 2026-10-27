// The empty state of the writing plane.
//
// The plane is the biggest block of the application, and when it is empty it
// must not be a void: the state offers the two actions that start a note and
// the notes that were opened last. A user who opens the application finds
// the way back to his own work instead of a picture of a file.

import { useT } from '../i18n/useT';
import { Icon } from '../ui/icons';
import '../styles/empty-note-state.css';

export interface EmptyNoteStateProps {
  /** The paths of the recently opened notes, the newest first. */
  recentPaths: string[];
  /** The paths that exist in the vault right now. */
  knownPaths: string[];
  /** Called when a note of the list is opened. */
  onOpen(path: string): void;
  /** Called when the user asks for a new note. */
  onCreate(): void;
  /** Called when the user asks for the note of the day. */
  onDaily(): void;
  /** The number of the notes that are listed. */
  limit?: number;
}

/** The name of a note: the last segment of its path. */
function nameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

export function EmptyNoteState(props: EmptyNoteStateProps) {
  const t = useT();
  const known = new Set(props.knownPaths);
  const limit = props.limit ?? 5;
  // A note that was deleted in the meantime is not offered: the list is a
  // way back into the vault, not a list of ghosts.
  const recent = props.recentPaths.filter((path) => known.has(path)).slice(0, limit);

  return (
    <div class="empty-state empty-note-state" data-testid="empty-state">
      <span class="empty-state-icon">
        <Icon name="file-text" size={32} />
      </span>
      <h2>{t('app.noNoteSelected')}</h2>
      <p>{t('app.noNoteSelectedHint')}</p>
      <div class="empty-note-actions">
        <button type="button" class="text-button" onClick={props.onCreate}>
          <Icon name="plus" size={14} />
          {t('app.emptyNewNote')}
        </button>
        <button type="button" class="text-button" onClick={props.onDaily}>
          <Icon name="calendar" size={14} />
          {t('app.emptyDailyNote')}
        </button>
      </div>
      {recent.length === 0 ? null : (
        <div class="empty-note-recent">
          <h3 class="empty-note-recent-title">{t('app.emptyRecent')}</h3>
          <ul class="empty-note-recent-list">
            {recent.map((path) => (
              <li key={path}>
                <button type="button" class="empty-note-recent-item" onClick={() => props.onOpen(path)}>
                  <span class="empty-note-recent-name">{nameOf(path)}</span>
                  {path === nameOf(path) ? null : (
                    <span class="empty-note-recent-path">{path}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
