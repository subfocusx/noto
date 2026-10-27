// The right column of the application.
//
// The column shows one panel at a time. The core of the application (the
// outline of the note) and the panels of the plugins are peers, not
// neighbours: a strip of tabs at the top of the column chooses which one is
// open, so the core is never mixed with the plugins.
//
// The choice of the panel lives in the store, not in the component: the
// column opens on the panel that was used last, and the panel of a plugin
// that was disabled falls back to the core of the application.
import type { ComponentChildren } from 'preact';
import type { PluginPanel } from '../plugins/contract';
import { useT } from '../i18n/useT';
import { PluginErrorBoundary } from './PluginSlots';

/** The id of the core panel of the right column (the outline of the note). */
export const RIGHT_COLUMN_OUTLINE_ID = 'outline';

export interface RightColumnProps {
  /** The content of the core panel of the column (the outline of the note). */
  outline: ComponentChildren;
  /** The panels of the plugins; they stand after the core panel. */
  panels: PluginPanel[];
  /** The id of the panel that is open. */
  activeId: string;
  /** Called when the user chooses another panel of the column. */
  onSelect(id: string): void;
}

/** Renders the content of a panel inside its own component.
 *
 * The call of the plugin happens inside the component, so an error of the
 * plugin is caught by the error boundary around it. */
function PluginPanelContent(props: { panel: PluginPanel }) {
  return <>{props.panel.render()}</>;
}

/**
 * The right column: a strip of tabs and the panel that is open.
 *
 * A panel of a plugin that throws does not take the column down: it is
 * wrapped into the error boundary of the plugin platform.
 */
export function RightColumn(props: RightColumnProps) {
  const t = useT();
  const known = props.panels.some((panel) => panel.id === props.activeId);
  const activeId = known ? props.activeId : RIGHT_COLUMN_OUTLINE_ID;
  const active = props.panels.find((panel) => panel.id === activeId);

  return (
    <div class="right-column">
      <div class="right-column-tabs" role="tablist" aria-label={t('rightColumn.label')}>
        <button
          type="button"
          role="tab"
          id="noto-right-tab-outline"
          aria-selected={activeId === RIGHT_COLUMN_OUTLINE_ID}
          aria-controls="noto-right-tabpanel"
          class={activeId === RIGHT_COLUMN_OUTLINE_ID ? 'active' : ''}
          onClick={() => props.onSelect(RIGHT_COLUMN_OUTLINE_ID)}
        >
          {t('outline.title')}
        </button>
        {props.panels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            role="tab"
            id={`noto-right-tab-${panel.id}`}
            aria-selected={activeId === panel.id}
            aria-controls="noto-right-tabpanel"
            class={activeId === panel.id ? 'active' : ''}
            onClick={() => props.onSelect(panel.id)}
          >
            {panel.title}
          </button>
        ))}
      </div>
      <div
        class="right-column-body"
        role="tabpanel"
        id="noto-right-tabpanel"
        aria-labelledby={`noto-right-tab-${activeId}`}
      >
        {active ? (
          <PluginErrorBoundary label={active.title}>
            <PluginPanelContent panel={active} />
          </PluginErrorBoundary>
        ) : (
          props.outline
        )}
      </div>
    </div>
  );
}
