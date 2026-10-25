import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { CalendarSection } from '../components/sections/CalendarSection';
import { buildMonthGrid, dayKey, MONTH_NAMES } from '../core/calendar/dates';
import { createReminder, formatReminderMoment } from '../core/reminders/types';
import { requestSystemNotifications, systemNotificationState } from '../core/reminders/system';
import { appStore } from '../core/store/appStore';
import type { Node } from '../types';

// The system notifications of the browser are replaced by a controllable stub:
// the tests must never ask the browser for a permission.
vi.mock('../core/reminders/system', () => ({
  systemNotificationState: vi.fn(() => 'granted' as const),
  canShowSystemNotifications: vi.fn(() => true),
  requestSystemNotifications: vi.fn(async () => true),
  showSystemNotification: vi.fn(),
}));

const mockedPermission = vi.mocked(systemNotificationState);
const mockedRequest = vi.mocked(requestSystemNotifications);

beforeEach(() => {
  mockedPermission.mockReturnValue('granted');
  mockedRequest.mockResolvedValue(true);
});

afterEach(() => {
  // The reminders are written to the storage of the browser: the storage is
  // emptied before the store is reset, so that a test never sees the
  // reminders of another test.
  localStorage.clear();
  appStore.reset();
  vi.restoreAllMocks();
});

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

/** The cell of the grid that stands for the given day. */
function cellOfDay(month: string, key: string): HTMLElement {
  const cells = buildMonthGrid(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
  const index = cells.findIndex((cell) => cell.key === key);
  const cell = document.querySelectorAll<HTMLElement>('.calendar-grid > button').item(index);
  if (!cell) throw new Error(`The day ${key} is not in the grid of ${month}.`);
  return cell;
}

/** A day of the month of today that is not today. */
function anotherDayOfThisMonth(): string {
  const now = new Date();
  const day = now.getDate() === 1 ? 2 : 1;
  return dayKey(new Date(now.getFullYear(), now.getMonth(), day));
}

/** Puts a reminder into the store of the application. */
function storeReminder(day: string, time: string, title: string): void {
  appStore.actions.addReminder(createReminder(day, time, title));
}

/** Opens the form of a new reminder and fills the field of the time. */
function openFormWithTime(time: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Add a reminder' }));
  fireEvent.input(screen.getByLabelText('Time of the reminder'), { target: { value: time } });
}

describe('the calendar section', () => {
  it('shows the month and its days', () => {
    renderCalendar();
    expect(screen.getByText('October 2026')).toBeTruthy();
    const grid = document.querySelector('.calendar-grid');
    expect(grid?.querySelectorAll('button')).toHaveLength(42);
    expect(screen.getByRole('button', { name: '12, 3 notes' })).toBeTruthy();
  });

  it('marks the days that carry records with the class of the records', () => {
    renderCalendar();
    // The 12th of October carries three notes, the 13th carries none.
    const withNotes = screen.getByRole('button', { name: '12, 3 notes' });
    expect(withNotes.classList.contains('calendar-day-has-notes')).toBe(true);
    const withoutNotes = screen.getByRole('button', { name: '13' });
    expect(withoutNotes.classList.contains('calendar-day-has-notes')).toBe(false);
  });

  it('marks the day of a daily note and not the days of its life', () => {
    // The note of the 29th was written on the 20th and changed on the 25th:
    // the calendar shows the day of the name.
    renderCalendar({
      files: [
        note('2026-10-29.md', 'notes/2026-10-29.md', '2026-10-20T10:00:00', '2026-10-25T10:00:00'),
      ],
      month: '2026-10',
      selectedDay: null,
    });

    const daily = screen.getByRole('button', { name: '29, 1 note' });
    expect(daily.classList.contains('calendar-day-has-notes')).toBe(true);
    expect(screen.getByRole('button', { name: '20' }).classList.contains('calendar-day-has-notes')).toBe(
      false,
    );
    expect(screen.getByRole('button', { name: '25' }).classList.contains('calendar-day-has-notes')).toBe(
      false,
    );
  });

  it('shows the daily note in the list of the notes of its day', () => {
    renderCalendar({
      files: [
        note('2026-10-29.md', 'notes/2026-10-29.md', '2026-10-20T10:00:00', '2026-10-25T10:00:00'),
      ],
      month: '2026-10',
      selectedDay: '2026-10-29',
    });

    expect(screen.getByText('2026-10-29.md')).toBeTruthy();
    expect(screen.getByText('notes/2026-10-29.md')).toBeTruthy();
  });

  it('marks the day of today with the class of today and with a dot', () => {
    const today = dayKey(new Date());
    const month = today.slice(0, 7);
    const another = anotherDayOfThisMonth();
    renderCalendar({
      files: [
        note('Today', 'notes/today.md', `${today}T10:00:00`, `${today}T10:00:00`),
        note('Another', 'notes/another.md', `${another}T10:00:00`, `${another}T10:00:00`),
      ],
      month,
      selectedDay: null,
    });

    // The day of today carries the two marks: the dot and the records.
    const cell = cellOfDay(month, today);
    expect(cell.classList.contains('calendar-day-today')).toBe(true);
    expect(cell.classList.contains('calendar-day-has-notes')).toBe(true);
    expect(cell.querySelector('.calendar-today-dot')).toBeTruthy();

    // The other day carries records only: it is not the day of the machine.
    const other = cellOfDay(month, another);
    expect(other.classList.contains('calendar-day-has-notes')).toBe(true);
    expect(other.classList.contains('calendar-day-today')).toBe(false);
    expect(other.querySelector('.calendar-today-dot')).toBeNull();
  });

  it('names the day with the number of its notes', () => {
    renderCalendar();
    expect(screen.getByRole('button', { name: '12, 3 notes' })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Open the note' }));
    expect(props.onCreateDailyNote).toHaveBeenCalledWith('2026-10-12');
  });

  it('puts the heading of the day and the button of the day on their own lines', () => {
    renderCalendar();
    const heading = screen.getByRole('heading', { name: '2026-10-12' });
    const button = screen.getByRole('button', { name: 'Open the note' });
    // The button does not share the row of the heading.
    expect(button.parentElement).not.toBe(heading.parentElement);
    // The button stands under the heading.
    expect(heading.nextElementSibling?.contains(button)).toBe(true);
  });

  it('does not show the button of the day when no day is selected', () => {
    renderCalendar({ selectedDay: null });
    expect(screen.queryByRole('button', { name: 'Open the note' })).toBeNull();
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

describe('the reminders of the calendar', () => {
  it('lists the reminders of the selected day and hides the reminders of another day', () => {
    storeReminder('2026-10-12', '18:00', 'Call the vet');
    storeReminder('2026-10-13', '09:30', 'Water the plants');

    renderCalendar();

    expect(screen.getByText('Call the vet')).toBeTruthy();
    expect(screen.queryByText('Water the plants')).toBeNull();
  });

  it('shows the moment of a reminder', () => {
    const reminder = createReminder('2026-10-12', '18:00', 'Call the vet');
    appStore.actions.addReminder(reminder);

    renderCalendar();

    expect(screen.getByText(formatReminderMoment(reminder))).toBeTruthy();
  });

  it('says that the day carries no reminder', () => {
    renderCalendar();
    expect(screen.getByText('No reminder on this day.')).toBeTruthy();
  });

  it('opens the form of a reminder and closes it again', () => {
    renderCalendar();

    expect(screen.queryByLabelText('Time of the reminder')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add a reminder' }));
    expect(screen.getByLabelText('Time of the reminder')).toBeTruthy();
    expect(screen.getByLabelText('Text of the reminder')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Time of the reminder')).toBeNull();
  });

  it('adds a reminder to the selected day with the chosen time', async () => {
    renderCalendar();
    openFormWithTime('18:00');
    fireEvent.input(screen.getByLabelText('Text of the reminder'), {
      target: { value: 'Call the vet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(appStore.getSnapshot().ui.reminders).toHaveLength(1));
    const reminder = appStore.getSnapshot().ui.reminders[0];
    expect(reminder.day).toBe('2026-10-12');
    expect(reminder.time).toBe('18:00');
    expect(reminder.title).toBe('Call the vet');
  });

  it('shows the reminder of the day in the list of the panel', async () => {
    renderCalendar();
    openFormWithTime('18:00');
    fireEvent.input(screen.getByLabelText('Text of the reminder'), {
      target: { value: 'Call the vet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(screen.getByText('Call the vet')).toBeTruthy());
    expect(appStore.getSnapshot().ui.reminders).toHaveLength(1);
  });

  it('uses the default text when the user writes nothing', async () => {
    renderCalendar();
    openFormWithTime('18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(appStore.getSnapshot().ui.reminders).toHaveLength(1));
    expect(appStore.getSnapshot().ui.reminders[0].title).toBe('Reminder');
  });

  it('confirms the form with Enter in the text field', async () => {
    renderCalendar();
    openFormWithTime('18:00');
    const field = screen.getByLabelText('Text of the reminder');
    fireEvent.input(field, { target: { value: 'Call the vet' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(appStore.getSnapshot().ui.reminders).toHaveLength(1));
    expect(appStore.getSnapshot().ui.reminders[0].title).toBe('Call the vet');
  });

  it('keeps the button of the form closed while the time is empty or malformed', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: 'Add a reminder' }));

    const add = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    fireEvent.input(screen.getByLabelText('Time of the reminder'), {
      target: { value: '18:0' },
    });
    expect(add.disabled).toBe(true);

    fireEvent.input(screen.getByLabelText('Time of the reminder'), {
      target: { value: '18:00' },
    });
    expect(add.disabled).toBe(false);
  });

  it('removes a reminder from the list', () => {
    storeReminder('2026-10-12', '18:00', 'Call the vet');
    renderCalendar();
    expect(screen.getByText('Call the vet')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove the reminder' }));

    expect(appStore.getSnapshot().ui.reminders).toHaveLength(0);
    expect(screen.queryByText('Call the vet')).toBeNull();
  });

  it('asks the browser for the permission of the system notifications', async () => {
    renderCalendar();
    openFormWithTime('18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
  });

  it('keeps the reminder and says so when the browser refuses the permission', async () => {
    mockedRequest.mockResolvedValue(false);
    renderCalendar();
    openFormWithTime('18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(appStore.getSnapshot().ui.reminders).toHaveLength(1));
    expect(
      screen.getByText(
        'The system notifications are not allowed: the reminder will only be shown in the application.',
      ),
    ).toBeTruthy();
  });

  it('says that the system notifications are not allowed yet', () => {
    mockedPermission.mockReturnValue('default');
    renderCalendar();

    expect(
      screen.getByText(
        'The system notifications are not allowed yet: the browser will ask for the permission when you add a reminder.',
      ),
    ).toBeTruthy();
  });

  it('says nothing about the system notifications when the browser allows them', () => {
    mockedPermission.mockReturnValue('granted');
    renderCalendar();

    expect(screen.queryByText(/system notifications/)).toBeNull();
  });
});
