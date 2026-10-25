// The history section of the left column.
//
// The section shows what happened before: the notes that were opened recently
// and the versions of the note that is open.
//
// The versions are the history of a note: every write of its content appends
// a new version. The section lists them, shows what changed between a
// version and the one before it, and restores an old version.
//
// The difference between two versions is computed by `core/views/diff.ts`,
// which is pure: the section only draws the rows it is given.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { listVersions, restoreVersion, type NoteVersion } from '../../api/versions';
import { diffAgainstPrevious, diffStats, type DiffRow } from '../../core/views/diff';
import { useAppActions } from '../../core/store/hooks';
import { formatDateTime } from '../../lib/format';
import { useT } from '../../i18n/useT';
import { RecentNotesPanel } from '../RecentNotesPanel';
import '../../styles/panel-versions.css';

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
  /** The path of the note that is open; its versions are listed. */
  openPath?: string;
  /** Loads the versions of a note; the API answers by default. */
  loadVersions?(path: string): Promise<NoteVersion[]>;
  /** Restores a version of the open note. */
  onRestore?(path: string, revision: number): void | Promise<void>;
}

/** The versions of a note, from the oldest to the newest. */
function byRevision(versions: readonly NoteVersion[]): NoteVersion[] {
  return [...versions].sort((a, b) => a.revision - b.revision);
}

/**
 * The section of the history: the recent notes and the versions of the note
 * that is open.
 */
export function HistorySection(props: HistorySectionProps) {
  const t = useT();
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const actions = useAppActions();

  const path = props.openPath;

  /**
   * The loader of the versions.
   *
   * It lives in a ref, so that a caller that builds a new function on every
   * render does not make the section read the versions again and again.
   */
  const loader = useRef(props.loadVersions);
  loader.current = props.loadVersions;

  useEffect(() => {
    if (!path) {
      setVersions([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = loader.current ?? ((note: string) => listVersions(note).then((r) => r.versions));
    void load(path)
      .then((list) => {
        if (cancelled) return;
        setVersions(byRevision(list));
        setSelected(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setVersions([]);
        setError(err instanceof Error ? err.message : t('history.versionsFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  /** The version the user looks at; the newest one by default. */
  const index = selected ?? (versions.length > 0 ? versions.length - 1 : -1);
  const version = index >= 0 ? versions[index] : undefined;

  const rows: DiffRow[] = useMemo(
    () => (version ? diffAgainstPrevious(versions, index) : []),
    [versions, index, version],
  );
  const stats = useMemo(() => diffStats(rows), [rows]);

  /**
   * Restores a version of the open note.
   *
   * The restore is a new write: the history of the note keeps the version
   * that was restored, and the note that is open shows the old text again.
   */
  const restore = async (notePath: string, revision: number): Promise<void> => {
    if (props.onRestore) {
      await props.onRestore(notePath, revision);
      return;
    }
    try {
      await restoreVersion(notePath, revision);
      await actions.refreshTree();
      await actions.openNote(notePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('history.restoreFailed'));
    }
  };

  return (
    <section class="column-section" aria-label={t('section.history')}>
      <header class="column-header section-header">
        <span class="section-header-title">{t('section.history')}</span>
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
          <p class="section-hint">{t('history.emptyRecent')}</p>
        )}

        <div class="sidebar-section">
          <div class="sidebar-section-title">
            <span>{t('history.versions')}</span>
          </div>

          {!path ? (
            <p class="section-hint">{t('history.hint')}</p>
          ) : null}

          {path && loading ? <p class="section-hint">{t('history.loading')}</p> : null}

          {path && !loading && error ? (
            <p class="section-hint" role="alert">
              {error}
            </p>
          ) : null}

          {path && !loading && !error && versions.length === 0 ? (
            <p class="section-hint">{t('history.empty')}</p>
          ) : null}

          {versions.length > 0 ? (
            <ul class="version-list">
              {[...versions].reverse().map((item) => {
                const itemIndex = versions.indexOf(item);
                const active = itemIndex === index;
                return (
                  <li key={item.revision} class={`version-item${active ? ' active' : ''}`}>
                    <button
                      type="button"
                      class="version-head"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => setSelected(itemIndex)}
                    >
                      <span class="version-revision">
                        {t('history.revision', { revision: item.revision })}
                      </span>
                      <span class="version-time">{formatDateTime(item.createdAt)}</span>
                    </button>
                    {active && path ? (
                      <button
                        type="button"
                        class="icon-button version-restore"
                        title={t('history.restore')}
                        aria-label={t('history.restoreRevision', { revision: item.revision })}
                        onClick={() => void restore(path, item.revision)}
                      >
                        {t('history.restoreButton')}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {version && rows.length > 0 ? (
            <div class="version-diff" aria-label={t('history.diff')}>
              <div class="version-diff-head">
                {t('history.diffStats', { added: stats.added, removed: stats.removed })}
              </div>
              <table class="version-diff-table">
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={rowIndex} class={`version-diff-row version-diff-${row.kind}`}>
                      <td class="version-diff-number">{row.left ? row.left.line : ''}</td>
                      <td class="version-diff-text version-diff-left">
                        {row.left ? row.left.text : ''}
                      </td>
                      <td class="version-diff-number">{row.right ? row.right.line : ''}</td>
                      <td class="version-diff-text version-diff-right">
                        {row.right ? row.right.text : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
