// The calendar section of the left column.
//
// The section answers one question: "what happened on that day?". It shows a
// month of the vault: the day of today carries a dot, the days that carry
// notes are tinted, and the notes of the day the user picked are listed under
// the grid.
//
// The two marks say two different things: the dot is the day of the machine,
// the tint is a day that carries records.
//
// The panel of the selected day carries a second list: the reminders of that
// day. A reminder is a moment the user asked to be told about; the
// application watches the list and, when the moment comes, it writes a
// notification and shows a system notification of the browser (see
// `../../core/reminders/`). The section only creates and removes them.
//
// The data comes from the tree of the vault: every note carries the moment of
// its creation and the moment of its last change. The section asks the core
// for the days and for the notes — it never reads the storage itself.
import { useMemo, useState } from 'preact/hooks';
import {
  buildMonthGrid,
  dayKey,
  MONTH_NAMES,
  monthLabel,
  parseMonthKey,
  shiftMonth,
  WEEK_DAY_LABELS,
  type CalendarCell,
} from '../../core/calendar/dates';
import { notesByDay, notesOnDay } from '../../core/calendar/notes';
import { ensureDailyNote, findDailyNote } from '../../core/calendar/dailyNote';
import { getVaultService } from '../../core/vault/vaultService';
import { createReminder, formatReminderMoment, isTimeKey } from '../../core/reminders/types';
import {
  requestSystemNotifications,
  systemNotificationState,
  type SystemNotificationState,
} from '../../core/reminders/system';
import { useAppActions, useAppState } from '../../core/store/hooks';
import { useT, type Translator } from '../../i18n/useT';
import { Icon } from '../../ui/icons';
import type { Node } from '../../types';

/** The name of the button that removes a reminder. */
const REMOVE_REMINDER = 'reminder.remove';

/**
 * The message of the panel when the browser does not allow the system
 * notifications.
 *
 * The reminder is still added: the application tells the user about it in the
 * list of the notifications, even when the browser stays silent.
 */
const SYSTEM_NOTIFICATIONS_OFF = 'reminder.notificationsOff';

/**
 * The message of the panel for the state of the permission of the browser.
 *
 * The line is a hint and not an error: the reminders work without it.
 */
function permissionNote(state: SystemNotificationState, t: Translator): string | null {
  switch (state) {
    case 'granted':
      return null;
    case 'denied':
      return t('reminder.notificationsOff');
    case 'unsupported':
      return t('reminder.notificationsUnsupported');
    default:
      return t('reminder.notificationsNotAllowed');
  }
}

export interface CalendarSectionProps {
  /** The notes of the vault. */
  files: Node[];
  /** The month that is shown, as `YYYY-MM`; the empty string means the month of today. */
  month: string;
  /** The selected day, as `YYYY-MM-DD`; `null` when no day is selected. */
  selectedDay: string | null;
  /** Called when the user walks to another month. */
  onMonthChange(month: string): void;
  /** Called when the user selects a day (`null` when the selection is cleared). */
  onDayChange(day: string | null): void;
  /** Called when the user opens a note of the day. */
  onOpenNote(path: string): void;
  /** Called when the user asks for the note of the selected day. */
  onCreateDailyNote(day: string): void;
}

export function CalendarSection(props: CalendarSectionProps) {
  const t = useT();
  const { year, month } = parseMonthKey(props.month);
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const byDay = useMemo(() => notesByDay(props.files), [props.files]);
  // The day of the machine: the dot of the grid marks it.
  const today = dayKey(new Date());

  const selectedDay = props.selectedDay;
  const dayNotes = useMemo(
    () => (selectedDay ? notesOnDay(byDay, selectedDay) : []),
    [byDay, selectedDay],
  );

  /** The daily note of the selected day, when the day already has one. */
  const dailyNote = useMemo(
    () => (selectedDay ? findDailyNote(props.files, selectedDay) : null),
    [props.files, selectedDay],
  );

  // The reminders live in the store of the application, so the panel and the
  // watcher of the moments always show the same list.
  const state = useAppState();
  const actions = useAppActions();

  // The reminders of the selected day, the earliest moment first.
  const dayReminders = useMemo(() => {
    if (!selectedDay) return [];
    return state.ui.reminders
      .filter((reminder) => reminder.day === selectedDay)
      .sort((a, b) =>
        a.time === b.time ? a.createdAt.localeCompare(b.createdAt) : a.time.localeCompare(b.time),
      );
  }, [state.ui.reminders, selectedDay]);

  // The form of a new reminder; it lives inside the panel of the day.
  const [formOpen, setFormOpen] = useState(false);
  const [time, setTime] = useState('');
  const [title, setTitle] = useState('');

  // The state of the permission of the browser is read at every render: the
  // answer of the user can change at any moment. A refused question leaves a
  // note behind, even when the browser keeps the permission at "default".
  const [refused, setRefused] = useState(false);
  const permission = systemNotificationState();
  const notificationNote = refused ? t(SYSTEM_NOTIFICATIONS_OFF) : permissionNote(permission, t);

  /**
   * Adds a reminder of the selected day.
   *
   * The reminder is added at once: the question of the browser must not hold
   * the list of the day. The question comes inside the gesture of the user —
   * the browser refuses a question that comes from a timer — and it is asked
   * without an `await` in between, so the gesture is still alive. The reminder
   * is added even when the permission is refused: the application tells the
   * user about it in the list of the notifications either way.
   */
  const addReminder = async (): Promise<void> => {
    const day = selectedDay;
    if (!day || !isTimeKey(time)) return;
    actions.addReminder(createReminder(day, time, title.trim() || t('reminder.defaultTitle')));
    setTime('');
    setTitle('');
    setFormOpen(false);
    const granted = await requestSystemNotifications();
    setRefused(!granted);
  };

  const closeForm = (): void => {
    setFormOpen(false);
    setTime('');
    setTitle('');
  };

  /**
   * Creates the daily note of the selected day and opens it.
   *
   * The calendar creates the note by itself: the user asks for the note of a
   * day and the note exists when the editor opens it.
   */
  const createDailyNote = async (day: string): Promise<void> => {
    const result = await ensureDailyNote(day, {
      files: props.files,
      create: (parentPath, name) => getVaultService().createFile(parentPath, name),
    });
    if (!result.node) return;
    await actions.refreshTree();
    props.onOpenNote(result.node.path);
  };

  /**
   * Opens the note of the selected day.
   *
   * The day that has no note gets one: the calendar creates it and opens it.
   * The shell is told about the day as well, so that it can show the note it
   * knows about.
   */
  const openDailyNote = (): void => {
    const day = selectedDay;
    if (!day) return;
    if (dailyNote) {
      props.onOpenNote(dailyNote.path);
    } else {
      void createDailyNote(day);
    }
    props.onCreateDailyNote(day);
  };

  return (
    <section class="column-section" aria-label={t('section.calendar')}>
      <header class="column-header section-header">
        <span class="section-header-title">{t('section.calendar')}</span>
      </header>

      <div class="column-body">
        <div class="calendar-toolbar">
          <button
            type="button"
            class="calendar-nav"
            aria-label={t('calendar.previousMonth')}
            onClick={() => props.onMonthChange(shiftMonth(props.month, -1))}
          >
            ‹
          </button>
          <span class="calendar-month">{monthLabel(props.month)}</span>
          <button
            type="button"
            class="calendar-nav"
            aria-label={t('calendar.nextMonth')}
            onClick={() => props.onMonthChange(shiftMonth(props.month, 1))}
          >
            ›
          </button>
        </div>

        <div class="calendar-week">
          {WEEK_DAY_LABELS.map((label) => (
            <span class="calendar-weekday" key={label}>
              {label}
            </span>
          ))}
        </div>

        <div class="calendar-grid">
          {grid.map((cell) => {
            const notes = byDay.get(cell.key) ?? [];
            const selected = cell.key === selectedDay;
            const hasNotes = notes.length > 0;
            const isToday = cell.key === today;
            return (
              <button
                key={cell.key}
                type="button"
                class={cellClass(cell, selected, hasNotes, isToday)}
                aria-label={dayLabel(cell, notes.length)}
                aria-pressed={selected}
                onClick={() => props.onDayChange(selected ? null : cell.key)}
              >
                <span class="calendar-day-number">{cell.day}</span>
                {isToday ? <span class="calendar-today-dot" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>

        <div class="calendar-day-notes">
          {selectedDay ? (
            <>
              <div class="calendar-day-notes-header">
                <h3 class="calendar-day-notes-title">{selectedDay}</h3>
                <div class="calendar-day-notes-actions">
                  <button
                    type="button"
                    class="q9-button calendar-open-note"
                    onClick={openDailyNote}
                  >
                    Open the note
                  </button>
                </div>
              </div>
              {dailyNote ? null : (
                <p class="calendar-daily-hint">
                  The note of this day does not exist yet: it is created when you open it.
                </p>
              )}
              {dayNotes.length === 0 ? (
                <p class="section-hint">{t('calendar.noNote')}</p>
              ) : (
                <ul class="calendar-note-list">
                  {dayNotes.map((note) => (
                    <li key={note.path}>
                      <button
                        type="button"
                        class="calendar-note"
                        onClick={() => props.onOpenNote(note.path)}
                      >
                        <span class="calendar-note-name">{note.name}</span>
                        <span class="calendar-note-path">{note.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div class="calendar-reminders">
                <div class="calendar-reminders-header">
                  <span class="calendar-reminders-title">{t('calendar.reminders')}</span>
                  {formOpen ? null : (
                    <button
                      type="button"
                      class="q9-button q9-button-quiet"
                      onClick={() => setFormOpen(true)}
                    >
                      Add a reminder
                    </button>
                  )}
                </div>

                {dayReminders.length === 0 ? (
                  <p class="calendar-reminder-empty">{t('calendar.noReminder')}</p>
                ) : (
                  <ul class="calendar-reminder-list">
                    {dayReminders.map((reminder) => (
                      <li class="calendar-reminder" key={reminder.id}>
                        <span class="calendar-reminder-time">
                          {formatReminderMoment(reminder)}
                        </span>
                        <span class="calendar-reminder-text">{reminder.title}</span>
                        <button
                          type="button"
                          class="icon-button calendar-reminder-remove"
                          aria-label={t(REMOVE_REMINDER)}
                          title={t(REMOVE_REMINDER)}
                          onClick={() => actions.removeReminder(reminder.id)}
                        >
                          <Icon name="x" size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {formOpen ? (
                  <form
                    class="calendar-reminder-form"
                    aria-label={t('calendar.addReminder')}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void addReminder();
                    }}
                  >
                    <div class="calendar-reminder-fields">
                      <input
                        type="time"
                        class="calendar-reminder-time-input"
                        aria-label={t('calendar.reminderTime')}
                        value={time}
                        onInput={(event) =>
                          setTime((event.currentTarget as HTMLInputElement).value)
                        }
                      />
                      <input
                        type="text"
                        class="calendar-reminder-text-input"
                        aria-label={t('calendar.reminderText')}
                        placeholder={t('reminder.defaultTitle')}
                        value={title}
                        onInput={(event) =>
                          setTitle((event.currentTarget as HTMLInputElement).value)
                        }
                        onKeyDown={(event) => {
                          // Enter in the text field confirms the form.
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          void addReminder();
                        }}
                      />
                    </div>
                    <div class="calendar-reminder-actions">
                      <button
                        type="button"
                        class="q9-button"
                        disabled={!isTimeKey(time)}
                        onClick={() => void addReminder()}
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        class="q9-button q9-button-quiet"
                        onClick={closeForm}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : null}

                {notificationNote ? (
                  <p class="calendar-reminder-note">{notificationNote}</p>
                ) : null}
              </div>
            </>
          ) : (
            <p class="section-hint">{t('calendar.hint')}</p>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The classes of a cell of the grid.
 *
 * The marks of a cell are two and they do not mean the same thing: the class
 * of the day of today says that the cell is the day of the machine, the class
 * of the records says that the day carries notes.
 */
function cellClass(
  cell: CalendarCell,
  selected: boolean,
  hasNotes: boolean,
  isToday: boolean,
): string {
  const classes = ['calendar-day'];
  if (!cell.inMonth) classes.push('calendar-day-outside');
  if (hasNotes) classes.push('calendar-day-has-notes');
  if (isToday) classes.push('calendar-day-today');
  if (selected) classes.push('calendar-day-selected');
  return classes.join(' ');
}

/**
 * The accessible name of a cell.
 *
 * The name of a day of the shown month is its number; the days of the
 * neighbouring months carry the name of their month, so that two days with
 * the same number are not the same button. The number of the notes of the day
 * is named too: the dot alone is not seen by everyone.
 */
function dayLabel(cell: CalendarCell, count: number): string {
  const notes = count > 0 ? `, ${count} ${count === 1 ? 'note' : 'notes'}` : '';
  if (cell.inMonth) return `${cell.day}${notes}`;
  const { month } = parseMonthKey(cell.key.slice(0, 7));
  return `${cell.day} ${MONTH_NAMES[month - 1]}${notes}`;
}
