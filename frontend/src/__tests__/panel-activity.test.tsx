// The tests of the graph of the activity.
//
// The graph shows how many notes were written on each of the last days. The
// counting is done by a pure module: the tests give it the notes and read the
// series of the days back.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { ActivityPanel } from '../components/sections/ActivityPanel';
import {
  ACTIVITY_DAYS,
  activityLevel,
  activitySeries,
  buildActivityDays,
  countActivityByDay,
} from '../core/graph/activity';
import type { Node } from '../types';

/** A note of the vault of the tests. */
function file(path: string, createdAt: string, updatedAt = createdAt): Node {
  return {
    id: path,
    name: path,
    path,
    type: 'file',
    parentPath: '',
    size: 0,
    modTime: updatedAt,
    revision: 1,
    createdAt,
    updatedAt,
  };
}

describe('the activity of the vault', () => {
  it('counts a note on the day it was written', () => {
    const counts = countActivityByDay([file('a.md', '2026-10-24T10:00:00')]);
    expect(counts.get('2026-10-24')).toBe(1);
  });

  it('counts a note on the day it was changed as well', () => {
    const counts = countActivityByDay([
      file('a.md', '2026-10-20T10:00:00', '2026-10-24T10:00:00'),
    ]);
    expect(counts.get('2026-10-20')).toBe(1);
    expect(counts.get('2026-10-24')).toBe(1);
  });

  it('counts a note once on a day', () => {
    const counts = countActivityByDay([
      file('a.md', '2026-10-24T10:00:00', '2026-10-24T18:00:00'),
    ]);
    expect(counts.get('2026-10-24')).toBe(1);
  });

  it('ignores the notes without a readable moment', () => {
    const counts = countActivityByDay([file('a.md', 'not a moment')]);
    expect(counts.size).toBe(0);
  });

  it('gives the last days, the oldest day first', () => {
    const days = buildActivityDays(new Map(), new Date(2026, 9, 24), 3);
    expect(days.map((day) => day.date)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24']);
  });

  it('puts the count of every day in the series', () => {
    const counts = new Map([['2026-10-24', 3]]);
    const days = buildActivityDays(counts, new Date(2026, 9, 24), 2);
    expect(days.map((day) => day.count)).toEqual([0, 3]);
  });

  it('gives the level of a day, relative to the busiest day', () => {
    expect(activityLevel(0, 10)).toBe(0);
    expect(activityLevel(2, 10)).toBe(1);
    expect(activityLevel(5, 10)).toBe(2);
    expect(activityLevel(7, 10)).toBe(3);
    expect(activityLevel(10, 10)).toBe(4);
  });

  it('counts the days of a list of notes', () => {
    const series = activitySeries([file('a.md', '2026-10-24T10:00:00')], new Date(2026, 9, 24));
    expect(series).toHaveLength(ACTIVITY_DAYS);
    expect(series[series.length - 1]?.count).toBe(1);
  });
});

describe('the panel of the activity', () => {
  it('draws a bar of every day', () => {
    const { container } = render(
      <ActivityPanel files={[file('a.md', '2026-10-24T10:00:00')]} today={new Date(2026, 9, 24)} />,
    );
    expect(container.querySelectorAll('.activity-bar')).toHaveLength(ACTIVITY_DAYS);
  });

  it('tells how many notes the days hold', () => {
    render(
      <ActivityPanel files={[file('a.md', '2026-10-24T10:00:00')]} today={new Date(2026, 9, 24)} />,
    );
    expect(screen.getByText(`1 note in ${ACTIVITY_DAYS} days`)).toBeTruthy();
  });
});
