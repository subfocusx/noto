import { useEffect, useState } from 'preact/hooks';
import { attachmentRawUrl, deleteAttachment, listAttachments, uploadAttachment } from '../api/client';
import { errorMessage } from '../lib/errors';
import { formatSize } from '../lib/format';
import type { Attachment } from '../types';

interface AttachmentsPanelProps {
  notePath: string | null;
  onInsert(markdown: string): void;
}

export function AttachmentsPanel(props: AttachmentsPanelProps) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    listAttachments()
      .then((res) => {
        setItems(res);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  useEffect(load, []);

  const upload = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    uploadAttachment(file, props.notePath ?? '')
      .then((attachment) => {
        load();
        props.onInsert(`![${attachment.name}](${attachmentRawUrl(attachment.id)})`);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
    input.value = '';
  };

  const remove = (attachment: Attachment) => {
    deleteAttachment(attachment.id)
      .then(load)
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  return (
    <section class="attachments" aria-label="Attachments">
      <div class="attachments-header">
        <h2>Attachments</h2>
        <label class="upload-button">
          <span>Upload image</span>
          <input type="file" accept="image/*" onChange={upload} aria-label="Upload attachment" />
        </label>
      </div>
      {busy ? <p class="dialog-hint">Uploading…</p> : null}
      {error ? <p class="error-text">{error}</p> : null}
      <ul class="attachment-list" data-testid="attachment-list">
        {items.map((attachment) => (
          <li key={attachment.id}>
            <a href={attachmentRawUrl(attachment.id)} target="_blank" rel="noopener noreferrer">
              {attachment.name}
            </a>
            <span class="muted">
              {attachment.mime} · {formatSize(attachment.size)}
            </span>
            <button
              type="button"
              class="icon-button danger"
              aria-label={`Delete attachment ${attachment.name}`}
              onClick={() => remove(attachment)}
            >
              ✕
            </button>
          </li>
        ))}
        {items.length === 0 ? <li class="dialog-hint">No attachments yet.</li> : null}
      </ul>
    </section>
  );
}
