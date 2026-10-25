// The references to the sounds in the text of a note.
//
// A recording lives in the text of the note as a Markdown image whose address
// carries the hint of the sound (`type=audio`). The functions here find those
// references in a text and read the length of the recording out of them, so
// the interface can show a chip instead of a bare link.

import { isAudioUrl } from './attachments';

/** A reference to a sound, found in the text of a note. */
export interface AudioReference {
  /** The start of the reference in the text. */
  from: number;
  /** The end of the reference in the text. */
  to: number;
  /** The address of the bytes of the sound. */
  url: string;
  /** The name of the reference: the text between the brackets. */
  label: string;
}

/** The pattern of a Markdown image: `![name](address)`. */
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^()\s]+)\)/g;

/**
 * The length of a recording, as it is written in the name of the reference.
 *
 * The name of a recording ends with its length as a clock: `Recording
 * 2026-10-25 19:56 (0:05)`. The brackets may be escaped, because the name
 * comes from the Markdown.
 *
 * @returns The clock of the recording, or null when the name carries none.
 */
export function recordingDuration(label: string): string | null {
  const match = /\\?\((\d+:\d{1,2})\\?\)/.exec(label);
  return match ? (match[1] ?? null) : null;
}

/**
 * Finds the references to the sounds in the text.
 *
 * Only the addresses that carry the hint of the sound are returned: a picture
 * of a note is not a sound.
 */
export function findAudioReferences(text: string): AudioReference[] {
  const found: AudioReference[] = [];
  for (const match of text.matchAll(IMAGE_PATTERN)) {
    const url = match[2] ?? '';
    if (!isAudioUrl(url)) continue;
    const from = match.index ?? 0;
    found.push({ from, to: from + match[0].length, url, label: match[1] ?? '' });
  }
  return found;
}
