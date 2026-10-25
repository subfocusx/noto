// The strip of the open notes.
//
// The strip is the header of the workspace: it keeps the height of every other
// header, so the line of the frame stays one line (see §3.2 of the design
// system). The notes that are open are pills with a gap between them — the
// shape lives in `styles/tabs.css`, the component describes no style of its
// own.
import { useRef } from 'preact/hooks';
import { useT } from '../i18n/useT';
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
  /**
   * The toggle of the preview of the note.
   *
   * It stands in the strip of the tabs, at its right end.
   */
  onTogglePreview?: {
    /** The label of the button (the text of the interface). */
    label: string;
    /** True when the preview is on the screen. */
    pressed: boolean;
    /** Opens or closes the preview. */
    onClick(): void;
  };
}

/**
 * The horizontal padding of a tab, in pixels.
 *
 * The stylesheet owns the shape of the tab: the constant mirrors the padding
 * of `styles/tabs.css` (`--space-3`), so the two can be checked against each
 * other by the tests.
 */
export const TAB_PADDING_X = 12;

/** The gap between two tabs, in pixels (`--space-1` of the stylesheet). */
export const TAB_GAP = 4;

/** The diameter of the dot of an unsaved note, in pixels. */
export const TAB_DIRTY_DOT = 6;

/**
 * The strip of the open notes.
 *
 * The strip is empty (and renders nothing) when no note is open.
 */
export function EditorTabs(props: EditorTabsProps) {
  const t = useT();
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
    <div class="tab-strip" role="tablist" aria-label={t('tabs.openNotes')} data-testid="tab-strip">
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
                aria-label={t('tabs.dirty', { name: tab.name })}
                data-testid="tab-dirty"
              />
            ) : null}
            <span class="tab-name">{tab.name}</span>
            {active ? (
              <span
                class="icon-button tab-close"
                role="button"
                tabIndex={0}
                aria-label={t('tabs.close', { name: tab.name })}
                title={t('tabs.close', { name: tab.name })}
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
          class="icon-button tab-new"
          aria-label={t('tabs.new')}
          title={t('tabs.new')}
          onClick={() => props.onNewTab?.()}
        >
          <Icon name="plus" size={14} />
        </button>
      ) : null}
      {/*
        The toggle of the preview stands in the strip of the tabs: the strip is
        the header of the column of the editor, and a button beside it (outside
        the strip) would break the line of the headers of the interface.
      */}
      {props.onTogglePreview ? (
        <button
          type="button"
          class="icon-button tab-preview"
          aria-label={props.onTogglePreview.label}
          title={props.onTogglePreview.label}
          aria-pressed={props.onTogglePreview.pressed ? 'true' : 'false'}
          onClick={() => props.onTogglePreview?.onClick()}
        >
          <Icon name="eye" size={14} />
        </button>
      ) : null}
    </div>
  );
}
