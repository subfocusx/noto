// Formatting helpers.

/** Human readable byte size. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The date of a moment, in the short form of the interface.
 *
 * The moment is read as ISO 8601 and shown in the local time of the machine:
 * "2026-10-24". A moment that cannot be read gives an empty string, so that
 * the interface never shows "Invalid Date".
 */
export function formatDate(value: string | null | undefined): string {
  const date = parseMoment(value);
  if (!date) return '';
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The date and the time of a moment, in the short form of the interface.
 *
 * The moment is read as ISO 8601 and shown in the local time of the machine:
 * "2026-10-24 18:05". A moment that cannot be read gives an empty string.
 */
export function formatDateTime(value: string | null | undefined): string {
  const date = parseMoment(value);
  if (!date) return '';
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${formatDate(value)} ${hours}:${minutes}`;
}

/**
 * The moment of a date, or null when the date cannot be read.
 *
 * The empty string is the moment the model uses for a note that has none: it
 * gives nothing to show.
 */
export function parseMoment(value: string | null | undefined): Date | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time);
}
