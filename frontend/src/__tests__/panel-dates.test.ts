// The tests of the formatting of the dates.
//
// The interface shows the moments of the life of a note (when it was written,
// when it was changed). The helpers of `lib/format.ts` turn the moments of the
// model into the short forms of the interface.
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, parseMoment } from '../lib/format';

describe('the formatting of the dates', () => {
  it('shows the date of a moment', () => {
    expect(formatDate('2026-10-24T18:05:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shows the date and the time of a moment', () => {
    expect(formatDateTime('2026-10-24T18:05:00Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('shows nothing when the note has no moment', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDateTime('')).toBe('');
  });

  it('shows nothing when the moment cannot be read', () => {
    expect(formatDate('not a moment')).toBe('');
    expect(formatDateTime('not a moment')).toBe('');
  });

  it('reads a moment', () => {
    expect(parseMoment('2026-10-24T18:05:00Z')?.getTime()).toBe(
      new Date('2026-10-24T18:05:00Z').getTime(),
    );
    expect(parseMoment('not a moment')).toBeNull();
    expect(parseMoment('')).toBeNull();
  });
});
