// The mime types of the attachments.
//
// The panel of the attachments must know, for every file, three things: what
// it is (the kind), which icon it gets, and whether a thumbnail may be shown.
// The answers are pure functions of the mime type and of the size, so they
// live here and are tested on their own.

/** The kinds of file the interface knows. */
export type AttachmentKind = 'image' | 'text' | 'pdf' | 'archive' | 'audio' | 'video' | 'file';

/**
 * The largest file that gets a thumbnail.
 *
 * A thumbnail is the file itself, scaled down by the browser: a huge image
 * would be downloaded in full for a picture of forty pixels.
 */
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

/** The image formats the browser shows without any conversion. */
const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

const ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/gzip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
]);

const TEXT_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/css',
  'text/javascript',
  'text/xml',
  'application/json',
  'application/xml',
  'application/x-yaml',
  'text/yaml',
]);

const AUDIO_MIMES = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4']);

const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']);

/**
 * The mime type without its parameters, in lower case.
 *
 * `text/plain; charset=utf-8` and `TEXT/PLAIN` are the same type.
 */
export function normalizeMime(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * True for an image the panel may preview.
 *
 * The SVG is deliberately left out: it is a scriptable format, so it is
 * treated as an ordinary file and never rendered by the panel.
 */
export function isImageMime(mime: string | null | undefined): boolean {
  const normalized = normalizeMime(mime);
  if (normalized === 'image/svg+xml') return false;
  if (IMAGE_MIMES.has(normalized)) return true;
  // An unknown image type (image/heic, image/tiff…) is still an image: the
  // browser decides whether it can show it.
  return normalized.startsWith('image/');
}

/** The kind of a file, from its mime type. */
export function attachmentKind(mime: string | null | undefined): AttachmentKind {
  const normalized = normalizeMime(mime);
  if (isImageMime(normalized)) return 'image';
  if (normalized === 'application/pdf') return 'pdf';
  if (TEXT_MIMES.has(normalized) || normalized.startsWith('text/')) return 'text';
  if (ARCHIVE_MIMES.has(normalized)) return 'archive';
  if (AUDIO_MIMES.has(normalized)) return 'audio';
  if (VIDEO_MIMES.has(normalized)) return 'video';
  return 'file';
}

/**
 * The name of the icon of the registry that represents the file.
 *
 * The names belong to the icon registry of the interface (`src/ui/icons`),
 * so the panel can render them without knowing the library.
 */
export function iconNameForMime(mime: string | null | undefined): string {
  switch (attachmentKind(mime)) {
    case 'image':
      return 'image';
    case 'archive':
      return 'archive';
    default:
      return 'file-text';
  }
}

/**
 * True when the file gets a thumbnail in the list.
 *
 * Only the images the browser can show, and only up to
 * {@link MAX_THUMBNAIL_BYTES}.
 */
export function shouldShowThumbnail(mime: string | null | undefined, size: number): boolean {
  if (!isImageMime(mime)) return false;
  if (!Number.isFinite(size) || size <= 0) return false;
  return size <= MAX_THUMBNAIL_BYTES;
}

/**
 * The date of a file, as `YYYY-MM-DD`.
 *
 * The date is taken in UTC, so the same file always shows the same day.
 * An empty or broken date gives an empty string: the panel then shows
 * nothing instead of "Invalid Date".
 */
export function formatAttachmentDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
