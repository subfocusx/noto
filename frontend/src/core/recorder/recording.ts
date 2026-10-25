// The result of a recording: its name, its reference in the text and the
// upload of the bytes as an attachment of the note.
//
// The reference is the one of an image (the one that the drop of a file into
// the editor uses): the preview shows the file and the text stays readable.

import { uploadAttachment } from '../../api/attachments';
import { attachmentReference, insertAttachmentReference } from '../../lib/drafts';
import type { Attachment } from '../../types';
import type { RecordingResult } from './recorder';

/** The extension of a recording, by its mime type. */
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** The extension of the given mime type. */
export function recordingExtension(mimeType: string): string {
  const mime = mimeType.split(';')[0].trim().toLowerCase();
  return EXTENSIONS[mime] ?? 'webm';
}

/** The length of a recording as a clock, `m:ss`. */
export function formatDuration(durationMs: number): string {
  const total = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/**
 * The name of the file of a recording.
 *
 * The name carries the moment of the recording, so the attachments of a note
 * stay readable in the list.
 */
export function recordingFileName(result: RecordingResult, when: Date = new Date()): string {
  const stamp =
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `-${pad(when.getHours())}-${pad(when.getMinutes())}-${pad(when.getSeconds())}`;
  return `recording-${stamp}.${recordingExtension(result.mimeType)}`;
}

/** The reference of the recording, for the text of the note. */
export function recordingReference(result: RecordingResult, rawUrl: string, when: Date = new Date()): string {
  const stamp =
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    ` ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  return attachmentReference(`Recording ${stamp} (${formatDuration(result.durationMs)})`, rawUrl);
}

/**
 * Puts the reference of the recording into the text.
 *
 * The reference goes to the caret of the editor and a space follows it, so the
 * user can keep writing right behind the link.
 */
export function insertRecordingReference(
  text: string,
  caret: number,
  reference: string,
): { text: string; caret: number } {
  return insertAttachmentReference(text, caret, reference);
}

/**
 * Uploads the bytes of the recording as an attachment of the note.
 *
 * The upload goes through the attachments API: the file lives on the server
 * and the reference of the text points at it.
 */
export async function uploadRecording(
  result: RecordingResult,
  notePath: string,
  fileName?: string,
): Promise<Attachment> {
  const name = fileName ?? recordingFileName(result);
  const file = new File([result.blob], name, { type: result.mimeType });
  return uploadAttachment(file, notePath);
}

/** Two digits, so the name of the file sorts as a date. */
function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
