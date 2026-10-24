// The calendar section of the left column.
//
// The section answers one question: "what happened on that day?". It shows a
// month of the vault: the days that carry notes are marked with a dot, and the
// notes of the day the user picked are listed under the grid.
//
// The data comes from the tree of the vault: every note carries the moment of
// its creation and the moment of its last change. The section asks the core
// for the days and for the notes — it never reads the storage itself.
import { useMemo } from 'preact/hooks';
import {
  buildMonthGrid,
  MONTH_NAMES,
  monthLabel,
  parseMonthKey,
  shiftMonth,
  WEEK_DAY_LABELS,
  type CalendarCell,
} from '../../core/calendar/dates';
import { notesByDay, notesOnDay } from '../../core/calendar/notes';
import type { Node } from '../../types';

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
  const { year, month } = parseMonthKey(props.month);
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const byDay = useMemo(() => notesByDay(props.files), [props.files]);

  const selectedDay = props.selectedDay;
  const dayNotes = useMemo(
    () => (selectedDay ? notesOnDay(byDay, selectedDay) : []),
    [byDay, selectedDay],
  );

  return (
    <section class="column-section" aria-label="Calendar">
      <header class="column-header section-header">
        <span class="section-header-title">Calendar</span>
      </header>

      <div class="column-body">
        <div class="calendar-toolbar">
          <button
            type="button"
            class="calendar-nav"
            aria-label="Previous month"
            onClick={() => props.onMonthChange(shiftMonth(props.month, -1))}
          >
            ‹
          </button>
          <span class="calendar-month">{monthLabel(props.month)}</span>
          <button
            type="button"
            class="calendar-nav"
            aria-label="Next month"
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
            return (
              <button
                key={cell.key}
                type="button"
                class={cellClass(cell, selected)}
                aria-label={dayLabel(cell, notes.length)}
                aria-pressed={selected}
                onClick={() => props.onDayChange(selected ? null : cell.key)}
              >
                <span class="calendar-day-number">{cell.day}</span>
                {notes.length > 0 ? <span class="calendar-dot" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>

        <div class="calendar-day-notes">
          {selectedDay ? (
            <>
              <div class="calendar-day-notes-header">
                <span class="calendar-day-notes-title">{selectedDay}</span>
                <button
                  type="button"
                  class="q9-button q9-button-quiet"
                  onClick={() => props.onCreateDailyNote(selectedDay)}
                >
                  Open the note of the day
                </button>
              </div>
              {dayNotes.length === 0 ? (
                <p class="section-hint">No note on this day.</p>
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
            </>
          ) : (
            <p class="section-hint">Pick a day to see the notes of that day.</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** The classes of a cell of the grid. */
function cellClass(cell: CalendarCell, selected: boolean): string {
  const classes = ['calendar-day'];
  if (!cell.inMonth) classes.push('calendar-day-outside');
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
