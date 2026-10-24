// The reminders of the user.
//
// A reminder is a moment the user asked to be told about: the calendar offers
// it for every day, and when the moment comes the application writes an entry
// into the list of the notifications and shows a system notification of the
// browser.
//
// The list lives in `localStorage` under its own key: a reminder belongs to
// the user and not to the vault, and it must survive a reload of the page.
//
// Every moment is a **local** moment: the user reads the calendar in the time
// of the machine, so a reminder of the "24th at 18:00" must not depend on the
// time zone of the server. The parts of the moment are therefore read one by
// one and never parsed as an UTC date.

/** One reminder. */
export interface Reminder {
  /** The identifier of the reminder; it never changes. */
  id: string;
  /** The day of the reminder, as `YYYY-MM-DD`. */
  day: string;
  /** The time of the day of the reminder, as `HH:MM` (24 hours, local). */
  time: string;
  /** The text of the reminder. */
  title: string;
  /** The path of the note the reminder is about, if any. */
  path?: string;
  /** The moment the reminder was created, in ISO 8601. */
  createdAt: string;
}

/** The key of the reminders in `localStorage`. */
export const REMINDERS_KEY = 'noto-reminders-v1';

/** The biggest number of the reminders. */
export const REMINDERS_LIMIT = 100;

/**
 * Reads the reminders.
 *
 * The values are validated on read: a broken entry is dropped instead of
 * breaking the interface.
 */
export function loadReminders(): Reminder[] {
  try {
    const raw = localStorage.getItem(REMINDERS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Reminder[] = [];
    for (const item of parsed) {
      const reminder = normalizeReminder(item);
      if (reminder) out.push(reminder);
    }
    return out;
  } catch {
    return [];
  }
}

/** Writes the reminders. */
export function saveReminders(list: Reminder[]): void {
  try {
    localStorage.setItem(REMINDERS_KEY, JSON.stringify(list.slice(0, REMINDERS_LIMIT)));
  } catch {
    // A full or unavailable storage must not break the application.
  }
}

/**
 * Reads a reminder out of an unknown value.
 *
 * A reminder without a day or without a time is not a reminder: it is dropped.
 */
function normalizeReminder(raw: unknown): Reminder | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Partial<Reminder>;
  if (typeof item.id !== 'string' || !item.id) return null;
  if (typeof item.day !== 'string' || !isDayKey(item.day)) return null;
  if (typeof item.time !== 'string' || !isTimeKey(item.time)) return null;
  return {
    id: item.id,
    day: item.day,
    time: item.time,
    title: typeof item.title === 'string' ? item.title : '',
    path: typeof item.path === 'string' ? item.path : undefined,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
  };
}

/** True when the value is a day, as `YYYY-MM-DD`. */
export function isDayKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** True when the value is a time of the day, as `HH:MM`. */
export function isTimeKey(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value);
}

/** The counter of the identifiers; it makes the identifiers unique. */
let counter = 0;

/**
 * Builds a reminder.
 *
 * The identifier is unique inside one session of the application: the time and
 * a counter are enough.
 */
export function createReminder(
  day: string,
  time: string,
  title: string,
  path?: string,
): Reminder {
  counter += 1;
  return {
    id: `r${Date.now().toString(36)}-${counter.toString(36)}`,
    day,
    time,
    title,
    path,
    createdAt: new Date().toISOString(),
  };
}

/**
 * The moment of a reminder, in milliseconds since the epoch.
 *
 * The parts are read one by one: `new Date('2026-10-24')` is the midnight in
 * the time zone of UTC, which in a negative offset is the evening of the day
 * before.
 */
export function reminderMoment(reminder: Reminder): number {
  const [year, month, day] = reminder.day.split('-').map((part) => Number.parseInt(part, 10));
  const [hour, minute] = reminder.time.split(':').map((part) => Number.parseInt(part, 10));
  const date = new Date(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
    0,
    0,
  );
  return date.getTime();
}

/**
 * True when the moment of the reminder has come.
 *
 * A reminder that has passed is due until it is removed: the application must
 * not lose it because the tab was closed at the wrong moment.
 */
export function isDue(reminder: Reminder, now: number): boolean {
  return reminderMoment(reminder) <= now;
}

/** Puts a reminder at the head of the list. */
export function addReminder(list: Reminder[], reminder: Reminder): Reminder[] {
  return [reminder, ...list.filter((item) => item.id !== reminder.id)].slice(0, REMINDERS_LIMIT);
}

/** Removes a reminder from the list. */
export function removeReminder(list: Reminder[], id: string): Reminder[] {
  return list.filter((item) => item.id !== id);
}

/**
 * The name of a moment for the interface: "24 October, 18:00".
 *
 * The name is built from the local parts of the moment, so it is the same
 * whatever the locale of the machine.
 */
export function formatReminderMoment(reminder: Reminder): string {
  const [year, month, day] = reminder.day.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  const name = date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
  return `${name}, ${reminder.time}`;
}
