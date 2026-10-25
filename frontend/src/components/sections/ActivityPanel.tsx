// The graph of the activity.
//
// The bar shows how many notes were written on each of the last days. It is
// the small answer to the question "have I been working?" — the counts of the
// footer tell the size of the vault, the graph tells its rhythm.
//
// The module of the activity (`core/graph/activity.ts`) counts the days; this
// one draws them.
import { useMemo } from 'preact/hooks';
import type { Node } from '../../types';
import { ACTIVITY_DAYS, activityLevel, activitySeries } from '../../core/graph/activity';
import { useT } from '../../i18n/useT';
import '../../styles/panel-activity.css';

export interface ActivityPanelProps {
  /** The notes of the vault. */
  files: Node[];
  /** The number of the days the graph shows. */
  days?: number;
  /** The day the graph ends at; the day of today by default. */
  today?: Date;
}

/**
 * The graph of the activity of the vault.
 */
export function ActivityPanel(props: ActivityPanelProps) {
  const t = useT();
  const series = useMemo(
    () => activitySeries(props.files, props.today ?? new Date(), props.days ?? ACTIVITY_DAYS),
    [props.files, props.today, props.days],
  );
  const max = series.reduce((most, day) => Math.max(most, day.count), 0);
  const total = series.reduce((sum, day) => sum + day.count, 0);

  return (
    <div class="activity-graph" aria-label={t('activity.label', { count: series.length })}>
      <div class="activity-bars">
        {series.map((day) => (
          <span
            key={day.date}
            class={`activity-bar activity-level-${activityLevel(day.count, max)}`}
            title={
              day.count === 1
                ? t('activity.dayOne', { date: day.date })
                : t('activity.dayMany', { date: day.date, count: day.count })
            }
            data-date={day.date}
            data-count={day.count}
          />
        ))}
      </div>
      <span class="activity-summary">
        {total === 1
          ? t('activity.summaryOne', { count: total, days: series.length })
          : t('activity.summaryMany', { count: total, days: series.length })}
      </span>
    </div>
  );
}
