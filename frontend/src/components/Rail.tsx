// The rail of the sections.
//
// The rail is the narrow column on the left of the window. It holds the icons
// of the sections of the application and nothing else: the column next to it
// shows the content of the section that is pressed.
//
// The rail is an accordion: exactly one section is open at a time, and the
// rail itself never disappears. The user therefore always sees where the
// sections are, and always knows which one is open.
//
// The rail has the shape of the ribbon of Obsidian: a narrow column of icons
// without letters. The name of a section lives in the accessible name of its
// button and in its tooltip. The sections are grouped in two — the notes and
// the life of the storage — and a thin line separates the groups.
import { Fragment } from 'preact';
import type { FindMode, RailSection } from '../core/store/types';
import { RAIL_SECTIONS } from '../core/commands/appCommands';
import { useT } from '../i18n/useT';
import { Icon } from '../ui/icons';

export interface RailProps {
  /** The section that is open in the column. */
  section: RailSection;
  /**
   * The module of the window of the search that is open, `null` when the
   * window is closed.
   *
   * The search and the filters are not sections of the column any more: they
   * live in one window over the application. The sign that opened the window
   * stays pressed while the window is open.
   */
  findMode?: FindMode | null;
  /** Called when the user presses the icon of a section. */
  onSelect(section: RailSection): void;
  /** The theme that is applied to the interface. */
  theme: 'light' | 'dark';
  /** Called when the user asks for the other theme. */
  onToggleTheme(): void;
  /** Called when the user asks for the settings of the application. */
  onOpenSettings(): void;
  /** The notifications that were not read; zero shows no badge. */
  unreadCount?: number;
}

/**
 * The rail of the sections.
 *
 * The pressed section carries `aria-current`, so the assistive technology
 * announces which section of the column is open.
 */
export function Rail(props: RailProps) {
  const t = useT();
  const themeLabel =
    props.theme === 'dark' ? t('rail.themeLight') : t('rail.themeDark');
  const unread = props.unreadCount ?? 0;

  return (
    <nav class="rail" aria-label={t('rail.sections')}>
      <ul class="rail-items">
        {RAIL_SECTIONS.map((entry, index) => {
          const previous = RAIL_SECTIONS[index - 1];
          // The line between the groups stands in front of the first section of
          // the second group.
          const startsGroup = previous !== undefined && previous.group !== entry.group;
          const active =
            props.section === entry.id ||
            (props.findMode !== null && props.findMode !== undefined && entry.id === props.findMode);
          const showBadge = entry.id === 'notifications' && unread > 0;

          return (
            <Fragment key={entry.id}>
              {startsGroup ? (
                <li class="rail-separator-slot">
                  <span class="rail-separator" aria-hidden="true" />
                </li>
              ) : null}
              <li>
                <button
                  type="button"
                  class="rail-item"
                  aria-current={active ? 'page' : undefined}
                  aria-label={t(entry.titleKey)}
                  title={t(entry.titleKey)}
                  data-section={entry.id}
                  data-testid={`rail-${entry.id}`}
                  onClick={() => props.onSelect(entry.id)}
                >
                  <Icon name={entry.icon} size={17} />
                  {showBadge ? (
                    <span class="rail-badge" aria-hidden="true">
                      {unread}
                    </span>
                  ) : null}
                </button>
              </li>
            </Fragment>
          );
        })}
      </ul>

      <div class="rail-footer">
        <span class="rail-separator" aria-hidden="true" />
        <button
          type="button"
          class="rail-item"
          aria-label={themeLabel}
          title={themeLabel}
          data-testid="rail-theme"
          onClick={props.onToggleTheme}
        >
          <Icon name={props.theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
        <button
          type="button"
          class="rail-item"
          aria-label={t('rail.settings')}
          title={t('rail.settings')}
          data-testid="rail-settings"
          onClick={props.onOpenSettings}
        >
          <Icon name="settings" size={17} />
        </button>
      </div>
    </nav>
  );
}
