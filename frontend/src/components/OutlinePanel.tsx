/** One heading of the open note. */
export interface OutlineHeading {
  /** The identifier of the heading inside the document. */
  id: string;
  /** The text of the heading. */
  text: string;
  /** The level of the heading, from 1 to 4. */
  level: number;
  /** The line of the heading in the source of the note (1-based). */
  line?: number;
}

export interface OutlinePanelProps {
  /** The headings of the open note, in the order they appear. */
  headings: OutlineHeading[];
  /** The heading the cursor is in. */
  activeId?: string | null;
  /** Jumps to a heading. */
  onSelect(id: string): void;
  /** The title of the panel. */
  title?: string;
}

/**
 * The outline of the open note: the list of its headings.
 */
export function OutlinePanel(props: OutlinePanelProps) {
  return (
    <div class="outline-panel">
      <div class="outline-header">{props.title ?? 'Outline'}</div>
      {props.headings.length === 0 ? (
        <p class="outline-empty">No headings in this note.</p>
      ) : (
        <ul class="outline-list">
          {props.headings.map((heading) => {
            const active = heading.id === props.activeId;
            const level = Math.min(Math.max(heading.level, 1), 4);
            return (
              <li key={heading.id}>
                <button
                  type="button"
                  class={active ? `outline-item active outline-level-${level}` : `outline-item outline-level-${level}`}
                  aria-current={active ? 'true' : undefined}
                  title={heading.text}
                  onClick={() => props.onSelect(heading.id)}
                >
                  {heading.text}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
