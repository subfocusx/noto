import { useState } from 'preact/hooks';
import {
  exportAllUrl,
  exportFolderUrl,
  exportNoteUrl,
  importFiles,
  importZip,
} from '../api/client';
import { errorMessage } from '../lib/errors';
import { useT } from '../i18n/useT';
import type { ConflictPolicy, ImportResult } from '../types';
import { Dialog } from './Dialog';

export interface TransferPanelProps {
  open: boolean;
  onClose(): void;
  currentPath: string | null;
  onImported(): void;
}

export function TransferPanel(props: TransferPanelProps) {
  const t = useT();
  const [conflict, setConflict] = useState<ConflictPolicy>('skip');
  const [targetPath, setTargetPath] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [markdownFiles, setMarkdownFiles] = useState('');
  const [zipFile, setZipFile] = useState('');

  const summarize = (res: ImportResult) =>
    t('transfer.summary', {
      imported: res.imported.length,
      skipped: res.skipped.length,
      errors: res.errors.length,
    });

  const handleFiles = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    setMarkdownFiles(
      files.length === 1 ? files[0]!.name : t('transfer.filesSelected', { count: files.length }),
    );
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
    setZipFile(file.name);
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
    <Dialog title={t('transfer.title')} open={props.open} onClose={props.onClose}>
      <section class="transfer-section">
        <h3>{t('transfer.import')}</h3>
        <label class="field">
          <span>{t('transfer.targetFolder')}</span>
          <input
            type="text"
            value={targetPath}
            placeholder={t('transfer.root')}
            aria-label={t('transfer.importTargetFolder')}
            onInput={(e) => setTargetPath((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span>{t('transfer.onConflict')}</span>
          <select
            value={conflict}
            aria-label={t('transfer.conflictPolicy')}
            onChange={(e) => setConflict((e.target as HTMLSelectElement).value as ConflictPolicy)}
          >
            <option value="skip">{t('transfer.skip')}</option>
            <option value="rename">{t('transfer.rename')}</option>
            <option value="overwrite">{t('transfer.overwrite')}</option>
          </select>
        </label>
        <label class="field">
          <span>{t('transfer.markdownFiles')}</span>
          <span class="file-picker">
            <input
              type="file"
              class="file-picker-input"
              accept=".md,.markdown,text/markdown"
              multiple
              aria-label={t('transfer.markdownFiles')}
              onChange={handleFiles}
            />
            <span class="file-picker-button">{t('transfer.chooseFiles')}</span>
            <span class="file-picker-name">{markdownFiles}</span>
          </span>
        </label>
        <label class="field">
          <span>{t('transfer.zipArchive')}</span>
          <span class="file-picker">
            <input
              type="file"
              class="file-picker-input"
              accept=".zip,application/zip"
              aria-label={t('transfer.zipArchive')}
              onChange={handleZip}
            />
            <span class="file-picker-button">{t('transfer.chooseArchive')}</span>
            <span class="file-picker-name">{zipFile}</span>
          </span>
        </label>
        {busy ? <p class="dialog-hint">{t('transfer.importing')}</p> : null}
        {error ? <p class="error-text">{error}</p> : null}
        {result ? (
          <div class="import-summary" data-testid="import-summary">
            <p>{summarize(result)}</p>
            {result.imported.length ? (
              <p class="muted">{t('transfer.imported', { names: result.imported.join(', ') })}</p>
            ) : null}
            {result.skipped.length ? (
              <p class="muted">{t('transfer.skipped', { names: result.skipped.join(', ') })}</p>
            ) : null}
            {result.errors.length ? <p class="error-text">{result.errors.join('; ')}</p> : null}
          </div>
        ) : null}
      </section>

      <section class="transfer-section">
        <h3>{t('transfer.export')}</h3>
        <div class="button-row">
          <a
            class="text-button"
            href={props.currentPath ? exportNoteUrl(props.currentPath) : undefined}
            aria-disabled={!props.currentPath}
            download
          >
            {t('transfer.exportNote')}
          </a>
          <a class="text-button" href={exportFolderUrl(currentFolder)} download>
            {t('transfer.exportFolder')}
          </a>
          <a class="text-button" href={exportAllUrl()} download>
            {t('transfer.exportAll')}
          </a>
        </div>
      </section>
    </Dialog>
  );
}
