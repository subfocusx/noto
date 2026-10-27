// The outline of the open note.
//
// The outline is the skeleton of the note: its headings, with their level, as
// a tree. The section the cursor is in is highlighted, and the way to it (its
// ancestors) is kept visible, so that the user always knows where she is in
// the note. Clicking a heading jumps to it: the shell scrolls the editor to
// the line of the heading.
//
// The panel draws what `lib/outline.ts` computes: the module of the outline
// knows the Markdown, this one knows the interface.
import { useMemo } from 'preact/hooks';
import { useT } from '../i18n/useT';
import {
  activeSectionPath,
  outlineSections,
  type OutlineHeading,
  type OutlineSection,
} from '../lib/outline';
import '../styles/panel-outline.css';

export type { OutlineHeading, OutlineSection };

export interface OutlinePanelProps {
  /** The headings of the open note, in the order they appear. */
  headings: OutlineHeading[];
  /** The heading the cursor is in. */
  activeId?: string | null;
  /** Jumps to a heading. */
  onSelect(id: string): void;
  /** The title of the panel. */
  title?: string;
  /**
   * False hides the title of the panel.
   *
   * The panel of the right column stands under the strip of the tabs, and the
   * tab already carries the name: a second title would say it twice.
   */
  showTitle?: boolean;
}

/** The depth of the indentation of a level. */
function depthOf(level: number): number {
  return Math.min(Math.max(level, 1), 4);
}

/** One entry of the outline: a heading and the sections under it. */
function OutlineEntry(props: {
  section: OutlineSection;
  activePath: string[];
  onSelect(id: string): void;
}) {
  const { heading, children } = props.section;
  const active = heading.id === props.activePath[props.activePath.length - 1];
  const ancestor = props.activePath.includes(heading.id) && !active;
  const level = depthOf(heading.level);
  const classes = [
    'outline-item',
    `outline-level-${level}`,
    active ? 'active' : '',
    ancestor ? 'outline-ancestor' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li class="outline-entry">
      <button
        type="button"
        class={classes}
        aria-current={active ? 'true' : undefined}
        title={heading.text}
        onClick={() => props.onSelect(heading.id)}
      >
        {heading.text}
      </button>
      {children.length > 0 ? (
        <ul class="outline-list outline-list-nested">
          {children.map((child) => (
            <OutlineEntry
              key={child.heading.id}
              section={child}
              activePath={props.activePath}
              onSelect={props.onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The outline of the open note: the tree of its headings.
 */
export function OutlinePanel(props: OutlinePanelProps) {
  const t = useT();
  const sections = useMemo(() => outlineSections(props.headings), [props.headings]);
  const activePath = useMemo(
    () => activeSectionPath(sections, props.activeId),
    [sections, props.activeId],
  );

  return (
    <div class="outline-panel">
      {props.showTitle === false ? null : (
        <div class="outline-header">{props.title ?? t('outline.title')}</div>
      )}
      {sections.length === 0 ? (
        <p class="outline-empty">{t('outline.empty')}</p>
      ) : (
        <ul class="outline-list">
          {sections.map((section) => (
            <OutlineEntry
              key={section.heading.id}
              section={section}
              activePath={activePath}
              onSelect={props.onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
