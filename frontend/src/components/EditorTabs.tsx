import { Icon } from '../ui/icons';

/** One open note of the tab strip. */
export interface EditorTab {
  /** The path of the note in the vault. */
  path: string;
  /** The file name of the note. */
  name: string;
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

/**
 * The strip of the open notes.
 *
 * The strip is empty (and renders nothing) when no note is open.
 */
export function EditorTabs(props: EditorTabsProps) {
  if (props.tabs.length === 0) return null;
  return (
    <div class="tab-strip" role="tablist" aria-label="Open notes">
      {props.tabs.map((tab) => {
        const active = tab.path === props.activePath;
        return (
          <button
            key={tab.path}
            type="button"
            class={active ? 'tab active' : 'tab'}
            role="tab"
            aria-selected={active}
            title={tab.path}
            onClick={() => props.onSelect(tab.path)}
          >
            <span class="tab-name">{tab.name}</span>
            <span
              class="icon-button"
              role="button"
              tabIndex={0}
              aria-label={`Close ${tab.name}`}
              title={`Close ${tab.name}`}
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
