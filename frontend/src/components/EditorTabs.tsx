import { useRef } from 'preact/hooks';
import { Icon } from '../ui/icons';

/** One open note of the tab strip. */
export interface EditorTab {
  /** The path of the note in the vault. */
  path: string;
  /** The file name of the note. */
  name: string;
  /** True when the note has unsaved changes. */
  dirty?: boolean;
}

export interface EditorTabsProps {
  /** The open notes, in the order they are shown. */
  tabs: EditorTab[];
  /** The path of the active note. */
  activePath: string | null;
  /** Opens a note of the strip. */
  onSelect(path: string): void;
  /** Closes a note of the strip. */
  onClose(path: string): void;
  /** Opens an empty tab; the button is not shown when it is missing. */
  onNewTab?(): void;
}

/** The height of a tab, in pixels. */
export const TAB_HEIGHT = 32;

/** The horizontal padding of a tab, in pixels. */
export const TAB_PADDING_X = 8;

/** The gap between two tabs, in pixels. */
export const TAB_GAP = 2;

/** The diameter of the dot of an unsaved note, in pixels. */
export const TAB_DIRTY_DOT = 6;

/**
 * The style of a tab.
 *
 * The strip is flat: the active tab is marked by an underline of the accent
 * colour and by the surface colour, the other tabs stay transparent.
 */
function tabStyle(active: boolean): Record<string, string> {
  return {
    height: `${TAB_HEIGHT}px`,
    padding: `0 ${TAB_PADDING_X}px`,
    border: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    borderRadius: '0',
    background: active ? 'var(--bg-surface)' : 'transparent',
    color: active ? 'var(--fg)' : 'var(--fg-muted)',
    boxShadow: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    font: 'inherit',
    cursor: 'pointer',
  };
}

/**
 * The strip of the open notes.
 *
 * The strip is empty (and renders nothing) when no note is open.
 */
export function EditorTabs(props: EditorTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (props.tabs.length === 0) return null;

  /** Moves the focus and the selection to the neighbouring tab. */
  const move = (index: number, step: number) => {
    const count = props.tabs.length;
    const next = (index + step + count) % count;
    const tab = props.tabs[next];
    if (!tab) return;
    props.onSelect(tab.path);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      class="tab-strip"
      role="tablist"
      aria-label="Open notes"
      data-testid="tab-strip"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: `${TAB_GAP}px`,
        height: `${TAB_HEIGHT}px`,
        overflow: 'hidden',
      }}
    >
      {props.tabs.map((tab, index) => {
        const active = tab.path === props.activePath;
        return (
          <button
            key={tab.path}
            type="button"
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            class={active ? 'tab active' : 'tab'}
            role="tab"
            aria-selected={active}
            title={tab.path}
            data-testid="editor-tab"
            style={tabStyle(active)}
            onClick={() => props.onSelect(tab.path)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                move(index, 1);
                return;
              }
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                move(index, -1);
              }
            }}
          >
            {tab.dirty ? (
              <span
                class="tab-dirty"
                role="img"
                aria-label={`Unsaved changes in ${tab.name}`}
                data-testid="tab-dirty"
                style={{
                  width: `${TAB_DIRTY_DOT}px`,
                  height: `${TAB_DIRTY_DOT}px`,
                  minWidth: `${TAB_DIRTY_DOT}px`,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  display: 'inline-block',
                }}
              />
            ) : null}
            <span class="tab-name">{tab.name}</span>
            {active ? (
              <span
                class="icon-button"
                role="button"
                tabIndex={0}
                aria-label={`Close ${tab.name}`}
                title={`Close ${tab.name}`}
                data-testid="tab-close"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onClose(tab.path);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.stopPropagation();
                    props.onClose(tab.path);
                  }
                }}
              >
                <Icon name="x" size={12} />
              </span>
            ) : null}
          </button>
        );
      })}
      {props.onNewTab ? (
        <button
          type="button"
          class="icon-button"
          aria-label="New tab"
          title="New tab"
          onClick={() => props.onNewTab?.()}
        >
          <Icon name="plus" size={14} />
        </button>
      ) : null}
    </div>
  );
}
