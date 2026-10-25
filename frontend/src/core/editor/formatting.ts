// The formatting of the text of a note.
//
// The editor of Noto writes Markdown: the toolbar of the editor is not a
// rich text editor, it is a set of shortcuts that put the Markdown syntax
// around the selection. Every function here is pure: it takes the text of the
// note and the range of the selection and returns the new text with the new
// range of the selection, so the behaviour can be tested without a browser.

/** The text of a note and the range of the selection after an edit. */
export interface TextEdit {
  /** The new text of the note. */
  text: string;
  /** The new start of the selection. */
  from: number;
  /** The new end of the selection. */
  to: number;
}

/** The pair of the markers of an inline format. */
export interface Marker {
  /** The marker that opens the format. */
  open: string;
  /** The marker that closes the format. */
  close: string;
}

/** The markers of the inline formats of the toolbar. */
export const BOLD: Marker = { open: '**', close: '**' };
export const ITALIC: Marker = { open: '*', close: '*' };
export const UNDERLINE: Marker = { open: '<u>', close: '</u>' };
export const STRIKETHROUGH: Marker = { open: '~~', close: '~~' };
export const CODE: Marker = { open: '`', close: '`' };

/** The prefix of the headings, from the first level to the third. */
export const HEADINGS = ['# ', '## ', '### '];

/**
 * The range of the lines that the selection touches.
 *
 * The range starts at the beginning of the first line and ends at the end of
 * the last one, so a format of a line touches the whole line.
 */
export function lineRange(text: string, from: number, to: number): { from: number; to: number } {
  const start = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
  const endIndex = text.indexOf('\n', to);
  const end = endIndex === -1 ? text.length : endIndex;
  return { from: start, to: end };
}

/**
 * Wraps the selection with the marker, or unwraps it when it is already
 * wrapped.
 *
 * An empty selection gets a pair of markers with the cursor between them:
 * the user types the text between them.
 */
export function toggleWrap(text: string, from: number, to: number, marker: Marker): TextEdit {
  const selection = text.slice(from, to);
  const { open, close } = marker;
  const wrapped =
    selection.length >= open.length + close.length &&
    selection.startsWith(open) &&
    selection.endsWith(close);

  if (wrapped) {
    const inner = selection.slice(open.length, selection.length - close.length);
    // `**bold**` is not an italic text: the marker that is left inside tells
    // that the selection carries another format.
    const another = open === close && (inner.startsWith(open) || inner.endsWith(close));
    if (!another) {
      return {
        text: text.slice(0, from) + inner + text.slice(to),
        from: from,
        to: from + inner.length,
      };
    }
  }

  const inserted = `${open}${selection}${close}`;
  return {
    text: text.slice(0, from) + inserted + text.slice(to),
    from: from + open.length,
    to: from + open.length + selection.length,
  };
}

/**
 * Puts the prefix at the beginning of every line of the selection.
 *
 * The prefix of the headings replaces the prefix that the line already has,
 * so pressing the button of the first level on a heading of the second level
 * moves the heading up instead of stacking two prefixes.
 */
export function prefixLines(
  text: string,
  from: number,
  to: number,
  prefix: string,
  replaceHeadings = false,
): TextEdit {
  const range = lineRange(text, from, to);
  const block = text.slice(range.from, range.to);
  const lines = block.split('\n');
  const changed = lines.map((line, index) => {
    if (replaceHeadings) {
      const stripped = line.replace(/^#{1,6}\s+/, '');
      return prefix + stripped;
    }
    if (/^\d+\.\s/.test(prefix)) {
      // A numbered list numbers its lines from one.
      return `${index + 1}. ` + line.replace(/^\s*([-*+]|\d+\.)\s+/, '');
    }
    if (/^[-*+]\s/.test(prefix)) {
      // A list item replaces the marker of the list it belongs to.
      return prefix + line.replace(/^\s*([-*+]|\d+\.)\s+/, '');
    }
    return prefix + line;
  });
  const newBlock = changed.join('\n');
  const length = newBlock.length - block.length;
  return {
    text: text.slice(0, range.from) + newBlock + text.slice(range.to),
    from: range.from,
    to: range.to + length,
  };
}

/**
 * Turns the selection into a link.
 *
 * An empty selection gets an empty link with the cursor between the brackets,
 * ready for the address of the link.
 */
export function makeLink(text: string, from: number, to: number, url = ''): TextEdit {
  const selection = text.slice(from, to);
  const inserted = `[${selection}](${url})`;
  const cursor = selection.length > 0 ? from + inserted.length : from + 1;
  return {
    text: text.slice(0, from) + inserted + text.slice(to),
    from: cursor,
    to: cursor,
  };
}

/**
 * Inserts a line of text at the caret.
 *
 * The new line goes on its own line, under the line of the caret.
 */
export function insertBlock(text: string, from: number, to: number, block: string): TextEdit {
  const range = lineRange(text, from, to);
  const before = text.slice(0, range.from);
  const after = text.slice(range.to);
  const separator = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  const inserted = `${separator}${block}\n`;
  return {
    text: before + inserted + after,
    from: before.length + inserted.length,
    to: before.length + inserted.length,
  };
}
