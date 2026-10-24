/**
 * The scanner of the derived properties of a note.
 *
 * The rules are the ones of `docs/QUERY_LANGUAGE.md`, section 8, and they
 * are covered by the golden vectors of `shared/query-vectors.json`.
 */

/** The derived properties of a note. */
export interface NoteProps {
  /** The tags of the note, lower cased, in the order of appearance. */
  tags: string[];
  /** The title of the note: the text of the first `# heading`. */
  title: string;
  /** The note contains a task list. */
  hasTaskList: boolean;
  /** The note contains a task that is not done. */
  hasIncompleteTasks: boolean;
  /** The note contains a code block or inline code. */
  hasCode: boolean;
  /** The note contains an image. */
  hasImage: boolean;
  /** The note contains a link. */
  hasLink: boolean;
}

/** A tag is a `#` and a word of letters, digits, `_`, `-` and `/`. */
const TAG_RE = /#([\p{L}\p{N}_\-/]+)/gu;

/** An ATX heading: `#`, `##`... and a space. */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** A task of a task list: `- [ ]`, `- [x]`, `* [ ]`, `+ [x]`... */
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]/;

/** A fenced code block. */
const FENCE_RE = /^\s*(```+|~~~+)/;

/** An inline code span. */
const INLINE_CODE_RE = /`[^`]*`/;

/** The same span, for the global replacement. */
const INLINE_CODE_G_RE = /`[^`]*`/g;

/** A markdown image. */
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/;

/** A wiki link or a markdown link (an image is not a link). */
const WIKI_LINK_RE = /\[\[[^\]]*\]\]/;
const MD_LINK_RE = /(?<!!)\[[^\]]*\]\([^)]*\)/;

/**
 * Scans the text of a note and returns its derived properties.
 */
export function extractProps(content: string): NoteProps {
  const tags: string[] = [];
  const seen = new Set<string>();
  let title = '';
  let titleFound = false;
  let hasTaskList = false;
  let hasIncompleteTasks = false;
  let hasCode = false;
  let inFence = false;

  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const fence = FENCE_RE.exec(line);
    if (fence) {
      hasCode = true;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (!titleFound) {
      const heading = HEADING_RE.exec(line);
      if (heading) {
        titleFound = true;
        if ((heading[1] as string).length === 1) {
          title = (heading[2] as string).replace(/\s+#+\s*$/, '').trim();
        }
      }
    }

    const task = TASK_RE.exec(line);
    if (task) {
      hasTaskList = true;
      if (task[1] === ' ') hasIncompleteTasks = true;
    }

    if (INLINE_CODE_RE.test(line)) {
      hasCode = true;
    }

    // The tags of a line: the inline code is not a text.
    const text = line.replace(INLINE_CODE_G_RE, ' ');
    TAG_RE.lastIndex = 0;
    let match = TAG_RE.exec(text);
    while (match !== null) {
      const tag = (match[1] as string).toLowerCase();
      if (!seen.has(tag)) {
        seen.add(tag);
        tags.push(tag);
      }
      match = TAG_RE.exec(text);
    }
  }

  return {
    tags,
    title,
    hasTaskList,
    hasIncompleteTasks,
    hasCode,
    hasImage: IMAGE_RE.test(content),
    hasLink: WIKI_LINK_RE.test(content) || MD_LINK_RE.test(content),
  };
}
