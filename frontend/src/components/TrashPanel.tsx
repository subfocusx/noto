import { useEffect, useState } from 'preact/hooks';
import { getTrash } from '../api/client';
import { appStore } from '../core/store/appStore';
import { errorMessage } from '../lib/errors';
import type { Node } from '../types';
import { Dialog } from './Dialog';

export interface TrashPanelProps {
  open: boolean;
  onClose(): void;
  onRestored(): void;
}

export function TrashPanel(props: TrashPanelProps) {
  const [entries, setEntries] = useState<Node[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
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
    if (props.open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const restore = (entry: Node) => {
    appStore.actions
      .restoreFromTrash(entry.path)
      .then(() => {
        load();
        props.onRestored();
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  return (
    <Dialog title="Trash" open={props.open} onClose={props.onClose}>
      {loading ? <p class="dialog-hint">Loading…</p> : null}
      {error ? <p class="error-text">{error}</p> : null}
      {!loading && entries.length === 0 ? <p class="dialog-hint">Trash is empty.</p> : null}
      <ul class="trash-list" data-testid="trash-list">
        {entries.map((entry) => (
          <li key={entry.path}>
            <span class="trash-name">{entry.name}</span>
            <span class="trash-path">{entry.path}</span>
            <button type="button" class="text-button" onClick={() => restore(entry)}>
              Restore
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
