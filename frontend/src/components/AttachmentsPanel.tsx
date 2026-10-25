import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  attachmentContentUrl,
  attachmentRawUrl,
  deleteAttachment,
  getAttachmentPreview,
  listAttachments,
  searchAttachments,
  uploadAttachment,
} from '../api/client';
import type { AttachmentSearchHit } from '../api/client';
import { errorMessage } from '../lib/errors';
import { formatSize } from '../lib/format';
import {
  ATTACHMENT_PAGE_SIZE,
  hasMoreAttachments,
  visibleAttachments,
} from '../lib/attachment-list';
import {
  attachmentKind,
  formatAttachmentDate,
  iconNameForMime,
  isImageMime,
  shouldShowThumbnail,
} from '../lib/attachments';
import { Icon } from '../ui/icons';
import type { Attachment } from '../types';
import { useT } from '../i18n/useT';
import { Dialog } from './Dialog';
import '../styles/attachments.css';

export interface AttachmentsPanelProps {
  notePath: string | null;
  onInsert(markdown: string): void;
}

/** The attachment of the list: the server may add the date of the last change. */
interface PanelAttachment extends Attachment {
  modifiedAt?: string;
}

export function AttachmentsPanel(props: AttachmentsPanelProps) {
  const t = useT();
  const [items, setItems] = useState<PanelAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The number of the rows that are drawn (the list grows by pages). */
  const [limit, setLimit] = useState(ATTACHMENT_PAGE_SIZE);
  /** The query of the search inside the text of the attachments. */
  const [query, setQuery] = useState('');
  /** The hits of the last search (null when no search was made). */
  const [hits, setHits] = useState<AttachmentSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  /** The index, in the images, of the picture of the lightbox (-1 when closed). */
  const [lightbox, setLightbox] = useState(-1);
  /** The metadata of the picture of the lightbox. */
  const [preview, setPreview] = useState<{ width: number; height: number } | null>(null);

  const load = () => {
    listAttachments()
      .then((res) => {
        setItems(res as PanelAttachment[]);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  useEffect(load, []);

  // The images of the list: they are the pictures of the lightbox.
  const images = useMemo(() => items.filter((item) => isImageMime(item.mime)), [items]);
  const visible = visibleAttachments(items, limit);

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

  const openLightbox = (attachment: PanelAttachment) => {
    const index = images.findIndex((item) => item.id === attachment.id);
    if (index < 0) return;
    setLightbox(index);
    setPreview(null);
    getAttachmentPreview(attachment.id)
      .then((res) => setPreview({ width: res.width, height: res.height }))
      .catch(() => setPreview(null));
  };

  // The arrows move inside the lightbox.
  useEffect(() => {
    if (lightbox < 0) return;
    const onKey = (event: KeyboardEvent) => {
      const total = images.length;
      if (total === 0) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setLightbox((current) => (current < 0 ? current : (current - 1 + total) % total));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setLightbox((current) => (current < 0 ? current : (current + 1) % total));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox, images.length]);

  const runSearch = (event: Event) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setHits(null);
      return;
    }
    setSearching(true);
    searchAttachments(trimmed)
      .then((res) => {
        setHits(res);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setSearching(false));
  };

  const current = lightbox >= 0 ? images[lightbox] : undefined;

  return (
    <section class="attachments" aria-label={t('attachments.label')}>
      <div class="attachments-header">
        <h2>{t('attachments.title')}</h2>
        <label class="upload-button">
          <span>{t('attachments.upload')}</span>
          <input type="file" onChange={upload} aria-label={t('attachments.uploadLabel')} />
        </label>
      </div>
      {busy ? <p class="dialog-hint">{t('attachments.uploading')}</p> : null}
      {error ? <p class="error-text">{error}</p> : null}

      <form class="field" onSubmit={runSearch} role="search">
        <label class="field">
          <span>{t('attachments.searchLabel')}</span>
          <input
            type="search"
            value={query}
            placeholder={t('attachments.searchPlaceholder')}
            aria-label={t('attachments.searchLabel')}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </label>
        <button type="submit" class="text-button">
          {searching ? t('attachments.searching') : t('attachments.search')}
        </button>
      </form>

      {hits ? (
        <ul class="attachment-search-results" data-testid="attachment-search-results">
          {hits.map((hit) => (
            <li key={`${hit.noteId}:${hit.attachmentId}`}>
              <span class="attachment-name">{hit.name}</span>
              <span class="muted">{hit.mime}</span>
              <span class="attachment-snippet">{hit.snippet}</span>
              {hit.notePath ? <span class="muted">{hit.notePath}</span> : null}
            </li>
          ))}
          {hits.length === 0 ? <li class="dialog-hint">{t('attachments.noMatch')}</li> : null}
        </ul>
      ) : null}

      <ul class="attachment-list" data-testid="attachment-list">
        {visible.map((attachment) => {
          const thumbnail = shouldShowThumbnail(attachment.mime, attachment.size);
          const date = formatAttachmentDate(attachment.modifiedAt ?? attachment.createdAt);
          const audio = attachmentKind(attachment.mime) === 'audio';
          return (
            <li key={attachment.id}>
              {thumbnail ? (
                <button
                  type="button"
                  class="attachment-thumb"
                  aria-label={t('attachments.preview', { name: attachment.name })}
                  onClick={() => openLightbox(attachment)}
                >
                  <img
                    src={attachmentContentUrl(attachment.id)}
                    alt={attachment.name}
                    width={40}
                    height={40}
                    loading="lazy"
                  />
                </button>
              ) : (
                <span class="attachment-icon" aria-hidden="true">
                  <Icon name={iconNameForMime(attachment.mime)} size={20} />
                </span>
              )}
              <a href={attachmentRawUrl(attachment.id)} target="_blank" rel="noopener noreferrer">
                {attachment.name}
              </a>
              {audio ? (
                <span class="attachment-audio-badge">
                  <Icon name="mic" size={12} />
                  {t('editor.audio.label')}
                </span>
              ) : null}
              {audio ? (
                <audio
                  class="attachment-player"
                  controls
                  preload="none"
                  src={attachmentRawUrl(attachment.id)}
                  aria-label={t('attachments.play', { name: attachment.name })}
                />
              ) : null}
              <span class="muted">
                {attachment.mime} · {formatSize(attachment.size)}
                {date ? ` · ${date}` : ''}
              </span>
              <button
                type="button"
                class="icon-button danger"
                aria-label={t('attachments.delete', { name: attachment.name })}
                onClick={() => remove(attachment)}
              >
                ✕
              </button>
            </li>
          );
        })}
        {items.length === 0 ? <li class="dialog-hint">{t('attachments.empty')}</li> : null}
      </ul>

      {hasMoreAttachments(items, limit) ? (
        <button
          type="button"
          class="text-button"
          onClick={() => setLimit((value) => value + ATTACHMENT_PAGE_SIZE)}
        >
          {t('attachments.showMore', { count: items.length - limit })}
        </button>
      ) : null}

      {current ? (
        <Dialog title={current.name} open onClose={() => setLightbox(-1)}>
          <div class="attachment-lightbox">
            <img
              src={attachmentContentUrl(current.id)}
              alt={current.name}
              data-testid="attachment-lightbox-image"
            />
            {preview ? (
              <p class="muted">
                {preview.width} × {preview.height} px
              </p>
            ) : null}
            <div class="button-row">
              <button
                type="button"
                class="icon-button"
                aria-label={t('attachments.previousImage')}
                disabled={images.length < 2}
                onClick={() =>
                  setLightbox((index) => (index < 0 ? index : (index - 1 + images.length) % images.length))
                }
              >
                ←
              </button>
              <span class="muted">
                {lightbox + 1} / {images.length}
              </span>
              <button
                type="button"
                class="icon-button"
                aria-label={t('attachments.nextImage')}
                disabled={images.length < 2}
                onClick={() => setLightbox((index) => (index < 0 ? index : (index + 1) % images.length))}
              >
                →
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
