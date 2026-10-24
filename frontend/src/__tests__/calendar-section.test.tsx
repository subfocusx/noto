import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { CalendarSection } from '../components/sections/CalendarSection';
import { MONTH_NAMES } from '../core/calendar/dates';
import type { Node } from '../types';

/** A note of the tree. */
function note(name: string, path: string, createdAt: string, updatedAt: string): Node {
  return {
    id: path,
    name,
    path,
    type: 'file',
    parentPath: '',
    size: 42,
    modTime: updatedAt,
    revision: 1,
    createdAt,
    updatedAt,
  };
}

const october = [
  note('Alpha', 'notes/alpha.md', '2026-10-12T10:00:00', '2026-10-12T10:00:00'),
  note('Beta', 'notes/beta.md', '2026-10-12T11:00:00', '2026-10-12T11:00:00'),
  note('Gamma', 'notes/gamma.md', '2026-10-12T12:00:00', '2026-10-12T12:00:00'),
  note('Delta', 'notes/delta.md', '2026-10-01T10:00:00', '2026-10-20T10:00:00'),
];

function renderCalendar(overrides: Partial<Parameters<typeof CalendarSection>[0]> = {}) {
  const props = {
    files: october,
    month: '2026-10',
    selectedDay: '2026-10-12',
    onMonthChange: vi.fn(),
    onDayChange: vi.fn(),
    onOpenNote: vi.fn(),
    onCreateDailyNote: vi.fn(),
    ...overrides,
  };
  render(<CalendarSection {...props} />);
  return props;
}

describe('the calendar section', () => {
  it('shows the month and its days', () => {
    renderCalendar();
    expect(screen.getByText('October 2026')).toBeTruthy();
    const grid = document.querySelector('.calendar-grid');
    expect(grid?.querySelectorAll('button')).toHaveLength(42);
    expect(screen.getByRole('button', { name: '12, 3 notes' })).toBeTruthy();
  });

  it('marks the days that carry notes with a dot', () => {
    renderCalendar();
    // The 12th, the 1st and the 20th of October carry notes.
    expect(document.querySelectorAll('.calendar-dot')).toHaveLength(3);
  });

  it('shows the notes of the selected day', () => {
    renderCalendar();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('notes/alpha.md')).toBeTruthy();
    expect(screen.getByText('Gamma')).toBeTruthy();
  });

  it('opens a note of the day', () => {
    const props = renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }));
    expect(props.onOpenNote).toHaveBeenCalledWith('notes/alpha.md');
  });

  it('asks for the note of the day', () => {
    const props = renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Open the note of the day' }));
    expect(props.onCreateDailyNote).toHaveBeenCalledWith('2026-10-12');
  });

  it('walks to another month', () => {
    const props = renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(props.onMonthChange).toHaveBeenCalledWith('2026-09');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(props.onMonthChange).toHaveBeenCalledWith('2026-11');
  });

  it('selects a day', () => {
    const props = renderCalendar({ selectedDay: null });
    fireEvent.click(screen.getByRole('button', { name: '12, 3 notes' }));
    expect(props.onDayChange).toHaveBeenCalledWith('2026-10-12');
  });

  it('clears the selection when the selected day is pressed again', () => {
    const props = renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: '12, 3 notes' }));
    expect(props.onDayChange).toHaveBeenCalledWith(null);
  });

  it('asks the user to pick a day when no day is selected', () => {
    renderCalendar({ selectedDay: null });
    expect(screen.getByText('Pick a day to see the notes of that day.')).toBeTruthy();
  });

  it('says that the day has no note', () => {
    renderCalendar({ selectedDay: '2026-10-05' });
    expect(screen.getByText('No note on this day.')).toBeTruthy();
  });

  it('shows the month of today when no month is given', () => {
    renderCalendar({ month: '' });
    const today = new Date();
    const name = MONTH_NAMES[today.getMonth()];
    expect(screen.getByText(`${name} ${today.getFullYear()}`)).toBeTruthy();
  });
});
