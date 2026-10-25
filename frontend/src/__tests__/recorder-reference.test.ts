// The tests of the recording that becomes an attachment of the note.
//
// The upload goes through the attachments API (mocked here) and the reference
// of the recording goes into the text of the note.
import { describe, expect, it, vi } from 'vitest';
import {
  formatDuration,
  insertRecordingReference,
  recordingExtension,
  recordingFileName,
  recordingReference,
  uploadRecording,
} from '../core/recorder/recording';
import type { RecordingResult } from '../core/recorder/recorder';

const uploadAttachment = vi.fn(async () => ({
  id: 'att-1',
  name: 'recording.webm',
  mime: 'audio/webm',
  size: 5,
  createdAt: '2026-10-25T12:00:00Z',
}));

vi.mock('../api/attachments', () => ({
  uploadAttachment: (...args: unknown[]) => uploadAttachment(...(args as [])),
}));

const RESULT: RecordingResult = {
  blob: new Blob(['sound'], { type: 'audio/webm' }),
  mimeType: 'audio/webm',
  durationMs: 5_000,
};

describe('the recording in the note', () => {
  it('is uploaded as an attachment of the note', async () => {
    uploadAttachment.mockClear();

    const attachment = await uploadRecording(RESULT, 'notes/today.md');

    expect(attachment.id).toBe('att-1');
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    const [file, notePath] = uploadAttachment.mock.calls[0] as unknown as [File, string];
    expect(notePath).toBe('notes/today.md');
    expect(file.name).toMatch(/^recording-/);
    expect(file.type).toBe('audio/webm');
  });

  it('names the file with the moment of the recording', () => {
    const name = recordingFileName(RESULT, new Date(2026, 9, 25, 15, 17, 3));
    expect(name).toBe('recording-2026-10-25-15-17-03.webm');
    expect(recordingExtension('audio/ogg')).toBe('ogg');
    expect(recordingExtension('audio/webm;codecs=opus')).toBe('webm');
  });

  it('inserts the reference of the recording into the text', () => {
    const reference = recordingReference(RESULT, '/api/attachments/att-1/raw', new Date(2026, 9, 25, 15, 17));

    expect(reference).toContain('![Recording');
    expect(reference).toContain('/api/attachments/att-1/raw');
    // The address carries the hint of the sound: the preview of the note
    // shows a player and not a broken picture.
    expect(reference).toContain('type=audio');

    const result = insertRecordingReference('The note. ', 9, reference);
    expect(result.text).toContain(reference);
    // The reference goes to the caret and the caret stays behind it.
    expect(result.text.slice(0, 9)).toBe('The note.');
    // The caret sits right behind the reference and its space.
    expect(result.caret).toBe(9 + reference.length + 1);
    expect(result.text.slice(9, result.caret)).toBe(`${reference} `);
  });

  it('shows the length of the recording as a clock', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(7_000)).toBe('0:07');
    expect(formatDuration(75_000)).toBe('1:15');
  });
});
