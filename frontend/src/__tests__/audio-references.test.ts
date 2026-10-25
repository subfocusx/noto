// The tests of the references to the sounds in the text of a note.
//
// A recording lives in the text as a Markdown image whose address carries the
// hint of the sound. The interface finds those references to show a chip
// instead of a bare link.
import { describe, expect, it } from 'vitest';
import { findAudioReferences, recordingDuration } from '../lib/audioReferences';

const REFERENCE =
  '![Recording 2026-10-25 19:56 \\(0:05\\)](/api/attachments/att-1/raw?type=audio)';

describe('the references to the sounds', () => {
  it('finds the reference of a recording', () => {
    const text = `A note.\n\n${REFERENCE}\n`;
    const found = findAudioReferences(text);

    expect(found.length).toBe(1);
    expect(found[0]?.url).toBe('/api/attachments/att-1/raw?type=audio');
    expect(found[0]?.label).toBe('Recording 2026-10-25 19:56 \\(0:05\\)');
    expect(text.slice(found[0]!.from, found[0]!.to)).toBe(REFERENCE);
  });

  it('ignores the pictures', () => {
    expect(findAudioReferences('![photo](/api/attachments/att-2/raw)').length).toBe(0);
    expect(findAudioReferences('A note without any sound.').length).toBe(0);
  });

  it('finds every sound of the text', () => {
    const found = findAudioReferences(`${REFERENCE}\n\n${REFERENCE}`);
    expect(found.length).toBe(2);
    expect(found[1]!.from).toBeGreaterThan(found[0]!.to);
  });

  it('reads the length of the recording', () => {
    expect(recordingDuration('Recording 2026-10-25 19:56 (0:05)')).toBe('0:05');
    expect(recordingDuration('Recording 2026-10-25 19:56 \\(1:15\\)')).toBe('1:15');
    expect(recordingDuration('Sound')).toBeNull();
  });
});
