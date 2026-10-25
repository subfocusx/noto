// The tests of the daily note of the calendar.
//
// The calendar creates the daily note of a day by itself: the user asks for
// the note of a day and the note exists when the editor opens it.
//
// The storage is replaced by a double: the test never reads the disk.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import {
  dailyNoteName,
  dailyNotePath,
  ensureDailyNote,
  findDailyNote,
  hasDailyNote,
  isDailyNoteName,
} from '../core/calendar/dailyNote';
import type { Node } from '../types';

/** The names of the notes the tests created. */
const created: string[] = [];

/** A note of the vault of the tests. */
function file(path: string, name = path.split('/').pop() ?? path): Node {
  return {
    id: path,
    name,
    path,
    type: 'file',
    parentPath: '',
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '2026-10-12T10:00:00',
    updatedAt: '2026-10-12T10:00:00',
  };
}

vi.mock('../core/vault/vaultService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/vault/vaultService')>();
  return {
    ...actual,
    getVaultService: () => ({
      ...actual.createOpenVaultService(),
      createFile: async (parentPath: string, name: string) => {
        created.push(name);
        return file(parentPath ? `${parentPath}/${name}` : name, name);
      },
    }),
  };
});

// The section is imported after the double, so that it reads the double.
const { CalendarSection } = await import('../components/sections/CalendarSection');

describe('the daily note of a day', () => {
  it('names the note of a day after the day', () => {
    expect(dailyNoteName('2026-10-12')).toBe('2026-10-12.md');
  });

  it('knows the names of the daily notes', () => {
    expect(isDailyNoteName('2026-10-12.md')).toBe(true);
    expect(isDailyNoteName('Notes.md')).toBe(false);
  });

  it('gives the path of the note of a day', () => {
    expect(dailyNotePath('2026-10-12')).toBe('2026-10-12.md');
    expect(dailyNotePath('2026-10-12', 'journal')).toBe('journal/2026-10-12.md');
  });

  it('finds the note of a day among the notes of the vault', () => {
    const files = [file('notes.md'), file('2026-10-12.md')];
    expect(findDailyNote(files, '2026-10-12')?.path).toBe('2026-10-12.md');
    expect(hasDailyNote(files, '2026-10-13')).toBe(false);
  });

  it('creates the note of a day that has none', async () => {
    const createdByTest: string[] = [];
    const result = await ensureDailyNote('2026-10-12', {
      files: [],
      create: async (_parent, name) => {
        createdByTest.push(name);
        return file(name);
      },
    });
    expect(createdByTest).toEqual(['2026-10-12.md']);
    expect(result.created).toBe(true);
    expect(result.node?.path).toBe('2026-10-12.md');
  });

  it('does not create the note of a day that has one', async () => {
    const create = vi.fn();
    const result = await ensureDailyNote('2026-10-12', {
      files: [file('2026-10-12.md')],
      create,
    });
    expect(create).not.toHaveBeenCalled();
    expect(result.created).toBe(false);
    expect(result.node?.path).toBe('2026-10-12.md');
  });

  it('answers with nothing when the storage refuses the creation', async () => {
    const result = await ensureDailyNote('2026-10-12', {
      files: [],
      create: async () => {
        throw new Error('the storage is locked');
      },
    });
    expect(result.node).toBeNull();
    expect(result.created).toBe(false);
  });
});

describe('the calendar and the daily note', () => {
  it('creates the note of the selected day by itself', async () => {
    created.length = 0;
    const onOpenNote = vi.fn();
    const onCreateDailyNote = vi.fn();
    render(
      <CalendarSection
        files={[]}
        month="2026-10"
        selectedDay="2026-10-12"
        onMonthChange={() => undefined}
        onDayChange={() => undefined}
        onOpenNote={onOpenNote}
        onCreateDailyNote={onCreateDailyNote}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open the note' }));

    await waitFor(() => expect(created).toEqual(['2026-10-12.md']));
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith('2026-10-12.md'));
    // The shell is told about the day as well: it knows the note too.
    expect(onCreateDailyNote).toHaveBeenCalledWith('2026-10-12');
  });

  it('says that the note of the day does not exist yet', () => {
    render(
      <CalendarSection
        files={[]}
        month="2026-10"
        selectedDay="2026-10-12"
        onMonthChange={() => undefined}
        onDayChange={() => undefined}
        onOpenNote={() => undefined}
        onCreateDailyNote={() => undefined}
      />,
    );
    expect(
      screen.getByText('The note of this day does not exist yet: it is created when you open it.'),
    ).toBeTruthy();
  });

  it('opens the note of the day when it already exists', () => {
    created.length = 0;
    const onOpenNote = vi.fn();
    render(
      <CalendarSection
        files={[file('2026-10-12.md')]}
        month="2026-10"
        selectedDay="2026-10-12"
        onMonthChange={() => undefined}
        onDayChange={() => undefined}
        onOpenNote={onOpenNote}
        onCreateDailyNote={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open the note' }));

    expect(onOpenNote).toHaveBeenCalledWith('2026-10-12.md');
    expect(created).toEqual([]);
  });
});
