import { describe, expect, it } from 'vitest';
import { notesByDay } from '../core/calendar/notes';

/**
 * A note of the vault.
 *
 * The name is optional on purpose: a note of a test may carry no name at all,
 * and such a note keeps the old behaviour of the calendar.
 */
function note(createdAt: string, updatedAt: string, name?: string) {
  return { createdAt, updatedAt, ...(name === undefined ? {} : { name }) };
}

describe('the daily notes of the calendar', () => {
  it('puts a daily note on the day of its name', () => {
    const byDay = notesByDay([
      note('2026-10-20T10:00:00', '2026-10-20T10:00:00', '2026-10-29.md'),
    ]);
    expect(byDay.get('2026-10-29')?.map((item) => item.name)).toEqual(['2026-10-29.md']);
  });

  it('reads the day of a daily note without the extension of the file', () => {
    const byDay = notesByDay([
      note('2026-10-20T10:00:00', '2026-10-20T10:00:00', '2026-10-29'),
    ]);
    expect(byDay.get('2026-10-29')).toHaveLength(1);
  });

  it('keeps a daily note on the day of its name only', () => {
    // The note was written on the 20th and changed on the 25th: neither day is
    // the day of the note.
    const byDay = notesByDay([
      note('2026-10-20T10:00:00', '2026-10-25T10:00:00', '2026-10-29.md'),
    ]);
    expect(byDay.get('2026-10-20')).toBeUndefined();
    expect(byDay.get('2026-10-25')).toBeUndefined();
    expect(byDay.get('2026-10-29')).toHaveLength(1);
  });

  it('does not put a daily note on the day of its creation', () => {
    const byDay = notesByDay([
      note('2026-10-29T08:00:00', '2026-10-29T08:00:00', '2026-11-02.md'),
    ]);
    expect(byDay.get('2026-10-29')).toBeUndefined();
    expect(byDay.get('2026-11-02')).toHaveLength(1);
  });

  it('does not read a note that only starts with a day as a daily note', () => {
    const byDay = notesByDay([
      note('2026-10-01T10:00:00', '2026-10-01T10:00:00', '2026-10-29 meeting.md'),
    ]);
    // The name is not a day, so the note keeps the old behaviour: it belongs to
    // the day it was written on and to no other day.
    expect(byDay.get('2026-10-01')).toHaveLength(1);
    expect(byDay.get('2026-10-29')).toBeUndefined();
  });

  it('does not read an impossible day as a day', () => {
    const byDay = notesByDay([
      note('2026-10-01T10:00:00', '2026-10-12T10:00:00', '2026-13-45.md'),
    ]);
    // The name is not a day, so the note keeps the old behaviour.
    expect(byDay.get('2026-10-01')).toHaveLength(1);
    expect(byDay.get('2026-10-12')).toHaveLength(1);
  });

  it('keeps the old behaviour for a note without a name', () => {
    const byDay = notesByDay([note('2026-10-01T10:00:00', '2026-10-12T09:30:00')]);
    expect(byDay.get('2026-10-01')).toHaveLength(1);
    expect(byDay.get('2026-10-12')).toHaveLength(1);
  });

  it('puts a note without a name once on a day when it was created and changed on it', () => {
    const byDay = notesByDay([note('2026-10-01T10:00:00', '2026-10-01T23:00:00')]);
    expect(byDay.get('2026-10-01')).toHaveLength(1);
  });

  it('puts a note without a name on the day of its creation and on the day of its change', () => {
    const byDay = notesByDay([note('2026-10-01T10:00:00', '2026-10-12T09:30:00', 'Alpha.md')]);
    expect(byDay.get('2026-10-01')).toHaveLength(1);
    expect(byDay.get('2026-10-12')).toHaveLength(1);
  });

  it('keeps the daily note and the ordinary notes of the same day apart', () => {
    const byDay = notesByDay([
      note('2026-10-29T08:00:00', '2026-10-29T08:00:00', '2026-10-29.md'),
      note('2026-10-29T09:00:00', '2026-10-29T09:00:00', 'Alpha.md'),
    ]);
    expect(byDay.get('2026-10-29')?.map((item) => item.name)).toEqual([
      '2026-10-29.md',
      'Alpha.md',
    ]);
  });
});
