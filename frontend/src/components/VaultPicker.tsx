// The picker of the folder with the notes.
//
// The notes of Noto live in a folder that the user chooses (like the vault of
// Obsidian). The server owns the disk: it lists the directories, so the picker
// is a small browser of the file system and not a hack with the file input of
// the browser.
import { useEffect, useState } from 'preact/hooks';
import { browseVault, type VaultBrowse, type VaultDir } from '../api/client';
import { Icon } from '../ui/icons';

export interface VaultPickerProps {
  /** True when the picker is shown. */
  open: boolean;
  /** The path that is proposed now. */
  initialPath?: string;
  /** Called when the user confirms the folder. */
  onChoose(path: string): void;
  /** Called when the user closes the picker without choosing a folder. */
  onClose(): void;
}

/**
 * The dialog of the choice of the folder with the notes.
 *
 * It shows the current directory, the parent directory and the
 * subdirectories. The hidden directories are not shown: the internal data of
 * Noto must not be picked by accident.
 */
export function VaultPicker(props: VaultPickerProps) {
  const [listing, setListing] = useState<VaultBrowse | null>(null);
  const [path, setPath] = useState(props.initialPath ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The list is read when the dialog opens and every time the path changes.
  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void browseVault(path || undefined)
      .then((res) => {
        if (cancelled) return;
        setListing(res);
        setPath(res.path);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not read the directory');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, path]);

  if (!props.open) return null;

  const enter = (dir: VaultDir) => {
    setPath(dir.path);
  };

  return (
    <div class="dialog-backdrop" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div
        class="dialog vault-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose the storage of the notes"
        data-testid="vault-picker"
      >
        <header class="dialog-header">
          <h2>Choose the storage of the notes</h2>
          <button type="button" class="icon-button" aria-label="Close dialog" onClick={props.onClose}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <div class="dialog-body">
          <p class="dialog-hint">
            The notes are stored as Markdown files in the folder you choose. The internal data of Noto
            lives in a hidden <code>.noto</code> subfolder next to them.
          </p>

          <label class="field">
            <span class="field-label">Folder</span>
            <input
              type="text"
              class="input"
              value={path}
              placeholder="C:\\Users\\me\\Notes"
              aria-label="Path of the folder"
              onInput={(event) => setPath((event.target as HTMLInputElement).value)}
            />
          </label>

          {error ? (
            <p class="error-text" role="alert">
              {error}
            </p>
          ) : null}

          <div class="vault-browse">
            <div class="vault-browse-header">
              <button
                type="button"
                class="icon-button"
                aria-label="Parent directory"
                disabled={!listing?.parent}
                onClick={() => listing?.parent && setPath(listing.parent)}
              >
                <Icon name="chevron-right" size={14} class="rotate-180" />
              </button>
              <span class="vault-browse-path" title={listing?.path ?? path}>
                {listing?.path ?? path}
              </span>
            </div>
            <ul class="vault-browse-list" role="list">
              {loading ? <li class="muted">Loading…</li> : null}
              {!loading && listing && listing.dirs.length === 0 ? (
                <li class="muted">No subdirectories</li>
              ) : null}
              {(listing?.dirs ?? []).map((dir) => (
                <li key={dir.path}>
                  <button type="button" class="vault-browse-item" onClick={() => enter(dir)}>
                    <Icon name="folder" size={14} />
                    <span class="tree-name">{dir.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer class="dialog-footer">
          <button type="button" class="button" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="button primary"
            disabled={!path.trim()}
            onClick={() => props.onChoose(path.trim())}
          >
            Use this folder
          </button>
        </footer>
      </div>
    </div>
  );
}
