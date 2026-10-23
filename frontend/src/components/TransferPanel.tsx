import { useState } from 'preact/hooks';
import {
  exportAllUrl,
  exportFolderUrl,
  exportNoteUrl,
  importFiles,
  importZip,
} from '../api/client';
import { errorMessage } from '../lib/utils';
import type { ConflictPolicy, ImportResult } from '../types';
import { Dialog } from './Dialog';

interface TransferPanelProps {
  open: boolean;
  onClose(): void;
  currentPath: string | null;
  onImported(): void;
}

export function TransferPanel(props: TransferPanelProps) {
  const [conflict, setConflict] = useState<ConflictPolicy>('skip');
  const [targetPath, setTargetPath] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const summarize = (res: ImportResult) =>
    `Imported: ${res.imported.length}, skipped: ${res.skipped.length}, errors: ${res.errors.length}`;

  const handleFiles = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    importFiles(files, targetPath, conflict)
      .then((res) => {
        setResult(res);
        props.onImported();
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const handleZip = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    importZip(file, targetPath, conflict)
      .then((res) => {
        setResult(res);
        props.onImported();
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const currentFolder = props.currentPath?.includes('/')
    ? props.currentPath.slice(0, props.currentPath.lastIndexOf('/'))
    : '';

  return (
    <Dialog title="Import & Export" open={props.open} onClose={props.onClose}>
      <section class="transfer-section">
        <h3>Import</h3>
        <label class="field">
          <span>Target folder</span>
          <input
            type="text"
            value={targetPath}
            placeholder="(root)"
            aria-label="Import target folder"
            onInput={(e) => setTargetPath((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span>On conflict</span>
          <select
            value={conflict}
            aria-label="Conflict policy"
            onChange={(e) => setConflict((e.target as HTMLSelectElement).value as ConflictPolicy)}
          >
            <option value="skip">skip</option>
            <option value="rename">rename</option>
            <option value="overwrite">overwrite</option>
          </select>
        </label>
        <label class="field">
          <span>Markdown files</span>
          <input type="file" accept=".md,.markdown,text/markdown" multiple onChange={handleFiles} />
        </label>
        <label class="field">
          <span>Zip archive</span>
          <input type="file" accept=".zip,application/zip" onChange={handleZip} />
        </label>
        {busy ? <p class="dialog-hint">Importing…</p> : null}
        {error ? <p class="error-text">{error}</p> : null}
        {result ? (
          <div class="import-summary" data-testid="import-summary">
            <p>{summarize(result)}</p>
            {result.imported.length ? <p class="muted">Imported: {result.imported.join(', ')}</p> : null}
            {result.skipped.length ? <p class="muted">Skipped: {result.skipped.join(', ')}</p> : null}
            {result.errors.length ? <p class="error-text">{result.errors.join('; ')}</p> : null}
          </div>
        ) : null}
      </section>

      <section class="transfer-section">
        <h3>Export</h3>
        <div class="button-row">
          <a
            class="text-button"
            href={props.currentPath ? exportNoteUrl(props.currentPath) : undefined}
            aria-disabled={!props.currentPath}
            download
          >
            Export current note
          </a>
          <a class="text-button" href={exportFolderUrl(currentFolder)} download>
            Export current folder
          </a>
          <a class="text-button" href={exportAllUrl()} download>
            Export everything
          </a>
        </div>
      </section>
    </Dialog>
  );
}
