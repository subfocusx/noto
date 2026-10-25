// The "Activity" built-in plugin.
//
// The plugin shows a calendar of the days on which the notes of the vault
// were written: a heatmap of the last weeks, like the activity calendar of the
// `usememos/memos` project (MIT). Only the idea and the UX are taken — not a
// line of its code.
//
// The plugin reads the vault through the public contract only:
//
//   * `ctx.api.query()`  — the notes of the vault (the query `path != ""`);
//   * `ctx.api.getTree()` — the dates of the notes (the permission
//     `tree.read`);
//   * `ctx.registerPanel()` — the panel with the calendar.
//
// The dates of a note come from two places: the answer of the query carries
// them when the host knows them (the sealed mode evaluates the query over the
// decrypted notes and knows their dates), and the tree of the vault carries
// them in the open mode.
//
// The plugin does NOT import anything from the application (rules R3 and
// R13): the calendar is computed here, in the local time of the browser.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Plugin, PluginContext, PluginManifest } from '../../contract';

/* ---------------------------------------------------------------- manifest */

/** Id of the panel contributed by the plugin. */
export const ACTIVITY_PANEL_ID = 'activity.panel';

/** The number of the weeks of the calendar. */
export const ACTIVITY_WEEKS = 12;

/** The query that selects every note of the vault. */
export const ACTIVITY_QUERY = 'path != ""';

/**
 * Static description of the plugin.
 *
 * `query.read` — the notes of the vault (`api.query`);
 * `tree.read` — the dates of the notes (`api.getTree`);
 * `ui.contribute` — the panel and the command.
 */
export const activityManifest: PluginManifest = {
  id: 'activity',
  name: 'Activity',
  version: '1.2.0',
  manifestVersion: 1,
  minApiVersion: '1.2.0',
  description: 'Shows a calendar of the days on which the notes were written.',
  author: 'Noto',
  permissions: ['query.read', 'tree.read', 'ui.contribute'],
};

/* ------------------------------------------------------------------ helpers */

/** A day of the calendar. */
export interface ActivityDay {
  /** The day, in the local time, as `YYYY-MM-DD`. */
  date: string;
  /** The number of the notes written (or changed) that day. */
  count: number;
}

/**
 * The key of a day in the local time: `YYYY-MM-DD`.
 *
 * The local time is used on purpose: the user reads the calendar in the time
 * of the machine, and a note written at 23:30 belongs to that evening.
 */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The midnight of the day of the moment. */
export function startOfDay(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * The Monday of the week of the day.
 *
 * The week starts on Monday, like the calendar of the application.
 */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const weekday = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - weekday);
  return day;
}

/**
 * Counts the notes per day.
 *
 * A note is counted on the day of its last change; a note that was never
 * changed is counted on the day of its creation.
 */
export function countByDay(
  entries: readonly { createdAt?: string; updatedAt?: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const moment = entry.updatedAt ?? entry.createdAt;
    if (!moment) continue;
    const parsed = new Date(moment);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = dayKey(parsed);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Builds the calendar: the days of the last weeks, from the Monday of the
 * first week to the today.
 *
 * The days without a note are in the answer too (with a zero counter): the
 * picture is a grid, and a hole would break it.
 */
export function buildCalendar(
  counts: ReadonlyMap<string, number>,
  today: Date,
  weeks = ACTIVITY_WEEKS,
): ActivityDay[] {
  const last = startOfWeek(today);
  const first = new Date(last.getTime());
  first.setDate(first.getDate() - 7 * (weeks - 1));

  const days: ActivityDay[] = [];
  const cursor = new Date(first.getTime());
  const end = startOfDay(today).getTime();
  while (cursor.getTime() <= end) {
    const key = dayKey(cursor);
    days.push({ date: key, count: counts.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * The level of a day: 0 — empty, 1..4 — the more notes, the darker.
 */
export function levelOf(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/* ------------------------------------------------------------------- store */

/** The state shown by the panel. */
export interface ActivityState {
  /** True when the calendar was computed. */
  ready: boolean;
  /** The reason of the failure, null when everything is fine. */
  error: string | null;
  /** The days of the calendar. */
  days: ActivityDay[];
  /** The biggest counter of the calendar. */
  max: number;
  /** The number of the notes of the vault. */
  notes: number;
}

/** The empty state of the panel. */
export function emptyState(): ActivityState {
  return { ready: false, error: null, days: [], max: 0, notes: 0 };
}

/**
 * The shared state of the plugin.
 *
 * The subscriptions live in the plugin (and not in the view), so that they
 * are removed on the deactivation.
 */
export class ActivityStore {
  private state: ActivityState = emptyState();
  private readonly listeners = new Set<() => void>();

  /** The current state. */
  get(): ActivityState {
    return this.state;
  }

  /** Replaces the state and notifies the subscribers. */
  set(next: ActivityState): void {
    this.state = next;
    for (const listener of Array.from(this.listeners)) listener();
  }

  /** Subscribes to the state changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/* -------------------------------------------------------------------- view */

interface ActivityViewProps {
  /** The shared state of the plugin. */
  store: ActivityStore;
}

/** The content of the panel. */
export function ActivityView(props: ActivityViewProps) {
  const [, bump] = useState(0);
  useEffect(() => props.store.subscribe(() => bump((n) => n + 1)), [props.store]);

  const state = props.store.get();

  if (state.error) {
    return h(
      'div',
      { class: 'noto-activity', 'data-plugin': 'activity' },
      h('span', { class: 'noto-activity-error' }, state.error),
    );
  }

  if (!state.ready) {
    return h(
      'div',
      { class: 'noto-activity', 'data-plugin': 'activity' },
      h('span', { class: 'noto-activity-empty' }, 'The calendar is being built…'),
    );
  }

  const cells = state.days.map((day) =>
    h('div', {
      key: day.date,
      class: `noto-activity-cell level-${levelOf(day.count, state.max)}`,
      'data-date': day.date,
      title: `${day.date}: ${day.count}`,
    }),
  );

  return h(
    'div',
    { class: 'noto-activity', 'data-plugin': 'activity' },
    h(
      'div',
      {
        class: 'noto-activity-grid',
        role: 'img',
        'aria-label': `The calendar of the notes: ${state.notes} notes in ${state.days.length} days`,
      },
      cells,
    ),
    h(
      'div',
      { class: 'noto-activity-legend' },
      h('span', { class: 'noto-activity-legend-label' }, `Notes: ${state.notes}`),
      h(
        'span',
        { class: 'noto-activity-legend-levels' },
        [0, 1, 2, 3, 4].map((level) =>
          h('span', {
            key: `level:${level}`,
            class: `noto-activity-cell level-${level}`,
            'aria-hidden': 'true',
          }),
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ plugin */

/**
 * The plugin of the panel.
 *
 * The calendar is computed once at the activation and refreshed when a note
 * changes.
 */
export const activityPlugin: Plugin = {
  manifest: activityManifest,

  async activate(ctx: PluginContext): Promise<void> {
    const store = new ActivityStore();

    const compute = async (): Promise<void> => {
      const query = ctx.api.query;
      if (!query) {
        store.set({
          ...emptyState(),
          error: 'The query capability needs the plugin API 1.2.0.',
        });
        return;
      }
      try {
        const answer = await query.call(ctx.api, ACTIVITY_QUERY, 500);
        // The tree carries the dates of the notes in the open mode; the
        // answer of the query carries them in the sealed mode. The tree is
        // optional: a storage that cannot answer it is not an error.
        const dates = new Map<string, { createdAt?: string; updatedAt?: string }>();
        try {
          const tree = await ctx.api.getTree();
          for (const file of tree.files) {
            dates.set(file.path, { createdAt: file.createdAt, updatedAt: file.updatedAt });
          }
        } catch {
          /* the tree is not available: the dates of the answer are enough */
        }

        const entries = answer.hits.map((hit) => {
          const fromTree = dates.get(hit.path);
          return {
            createdAt: hit.createdAt ?? fromTree?.createdAt,
            updatedAt: hit.updatedAt ?? fromTree?.updatedAt,
          };
        });

        const counts = countByDay(entries);
        const days = buildCalendar(counts, new Date());
        const max = days.reduce((acc, day) => Math.max(acc, day.count), 0);
        store.set({ ready: true, error: null, days, max, notes: answer.hits.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error('the calendar could not be built', { message });
        store.set({ ...emptyState(), error: message });
      }
    };

    const cleanups = [
      ctx.on('note.created', () => void compute()),
      ctx.on('note.updated', () => void compute()),
      ctx.on('note.deleted', () => void compute()),
      ctx.on('note.renamed', () => void compute()),
    ];

    ctx.onDeactivate(() => {
      for (const cleanup of cleanups) cleanup();
    });

    ctx.registerPanel({
      id: ACTIVITY_PANEL_ID,
      title: 'Activity',
      render: () => h(ActivityView, { store }),
    });

    ctx.registerCommand({
      id: 'activity.rebuild',
      title: 'Activity: rebuild the calendar',
      description: 'Rebuilds the calendar of the days on which the notes were written.',
      run: () => {
        void compute();
      },
    });

    await compute();
  },
};
