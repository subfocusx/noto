// The list of the recently opened notes.
//
// The panel shows the last notes the user opened. A note that was deleted in
// the meantime is still listed, but it is marked as missing. The section can be
// collapsed, so the list takes no room when the user does not need it.
import type { ComponentChildren } from 'preact';
import { useT } from '../i18n/useT';
import { Icon } from '../ui/icons';

export interface RecentNotesPanelProps {
  /** The paths of the recent notes, the most recent first. */
  paths: string[];
  /** Called when a note of the list is opened. */
  onOpen(path: string): void;
  /** Called when a note is removed from the list. */
  onRemove(path: string): void;
  /** The paths that currently exist in the tree. */
  knownPaths: string[];
  /** True when the section is collapsed. */
  collapsed?: boolean;
  /** Called when the user collapses or expands the section. */
  onToggleCollapsed?(): void;
}

/** The name of a note: the last segment of its path. */
function nameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

/** The chevron of the header of the section. */
function Chevron(props: { collapsed: boolean }): ComponentChildren {
  if (props.collapsed) {
    return <Icon name="chevron-down" size={14} />;
  }
  return <Icon name="chevron-up" size={14} />;
}

export function RecentNotesPanel(props: RecentNotesPanelProps) {
  const t = useT();
  if (props.paths.length === 0) return null;

  const known = new Set(props.knownPaths);
  const collapsed = props.collapsed ?? false;

  return (
    <section class="sidebar-section" aria-label={t('recent.ariaLabel')}>
      <button
        type="button"
        class="sidebar-section-title sidebar-section-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('recent.expand') : t('recent.collapse')}
        title={collapsed ? t('recent.expand') : t('recent.collapse')}
        onClick={() => props.onToggleCollapsed?.()}
      >
        <span class="sidebar-section-label">{t('recent.label')}</span>
        <Chevron collapsed={collapsed} />
      </button>
      {collapsed ? null : (
        <ul class="recent-list">
          {props.paths.map((path) => {
            const name = nameOf(path);
            const missing = !known.has(path);
            return (
              <li
                key={path}
                class="recent-row"
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
              >
                <button
                  type="button"
                  class={`recent-item${missing ? ' missing' : ''}`}
                  title={path}
                  style={{ flex: '1', minWidth: 0 }}
                  onClick={() => props.onOpen(path)}
                >
                  <span class="tree-icon">
                    <Icon name="file-text" size={14} />
                  </span>
                  <span class="recent-name">{name}</span>
                </button>
                <button
                  type="button"
                  class="icon-button"
                  title={t('recent.remove', { name })}
                  aria-label={t('recent.remove', { name })}
                  onClick={() => props.onRemove(path)}
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
