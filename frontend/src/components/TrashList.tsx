// The list of the deleted notes.
//
// The list is shared by the section Trash of the left column and by the dialog
// of the trash: the two show the same notes and restore them in the same way.
import { useEffect, useState } from 'preact/hooks';
import { getTrash } from '../api/client';
import { appStore } from '../core/store/appStore';
import { useT } from '../i18n/useT';
import { errorMessage } from '../lib/errors';
import type { Node } from '../types';
import { IconButton } from '../ui/tooltip';

export interface TrashListProps {
  /** Called after a note was restored. */
  onRestored?(): void;
}

export function TrashList(props: TrashListProps) {
  const t = useT();
  const [entries, setEntries] = useState<Node[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = (): void => {
    setLoading(true);
    getTrash()
      .then((res) => {
        setEntries(res.entries ?? []);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restore = (entry: Node): void => {
    appStore.actions
      .restoreFromTrash(entry.path)
      .then(() => {
        load();
        props.onRestored?.();
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  return (
    <>
      {loading ? <p class="dialog-hint">{t('common.loading')}</p> : null}
      {error ? <p class="error-text">{error}</p> : null}
      {/* A refused load does not mean that the trash is empty: the two states
          must never be shown together. */}
      {!loading && !error && entries.length === 0 ? (
        <p class="dialog-hint">{t('trash.empty')}</p>
      ) : null}
      <ul class="trash-list" data-testid="trash-list">
        {entries.map((entry) => (
          <li key={entry.path}>
            <span class="trash-name">{entry.name}</span>
            <span class="trash-path">{entry.path}</span>
            <IconButton
              icon="rotate-ccw"
              label={t('trash.restore', { name: entry.name })}
              onClick={() => restore(entry)}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
