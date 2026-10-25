// The slides of a presentation.
//
// A note declares a presentation when it holds at least one separator: a line
// that carries three or more dashes (`---`) and nothing else. The separators
// split the note into slides.
//
// The rules of the Markdown of a presentation:
//
//  * a separator is a line that holds only three or more dashes (and the
//    spaces around them);
//  * a line of dashes inside a fenced code block is a line of code, not a
//    separator;
//  * the title of a slide is its first heading (`# …`); a slide without a
//    heading takes its first non-empty line as its title;
//  * the notes of the speaker are the lines that follow a line that holds
//    only `???`; they are not shown in the deck;
//  * a note without a separator holds no presentation.

/** A slide of a presentation. */
export interface Slide {
  /** The number of the slide, counted from zero. */
  index: number;
  /** The title of the slide. */
  title: string;
  /** The body of the slide, in Markdown. */
  content: string;
  /** The notes of the speaker, in Markdown. */
  notes: string;
}

/** A presentation: the slides of a note. */
export interface Presentation {
  /** The title of the presentation (the title of its first slide). */
  title: string;
  /** The slides, in the order of the note. */
  slides: Slide[];
}

/** A line of three or more dashes: the separator of two slides. */
const SEPARATOR = /^\s*-{3,}\s*$/;

/** A line of three or more dashes or of three or more tildes: a fence. */
const FENCE = /^\s*(?:```|~~~)/;

/** A line that holds only the marker of the notes of the speaker. */
const NOTES_MARKER = /^\s*\?\?\?\s*$/;

/** The longest title a slide may carry. */
const MAX_TITLE = 120;

/**
 * Reads the presentation of a note.
 *
 * Returns null when the note holds no separator: the note is an ordinary
 * note, not a presentation.
 */
export function parsePresentation(source: string): Presentation | null {
  const blocks = splitSlides(source);
  if (blocks.length < 2) return null;
  const slides: Slide[] = [];
  for (const block of blocks) {
    const slide = toSlide(block, slides.length);
    if (!slide) continue;
    slides.push(slide);
  }
  if (slides.length === 0) return null;
  return { title: slides[0].title, slides };
}

/**
 * Splits the text of a note into the blocks of the slides.
 *
 * The fences of the code are honoured: a line of dashes inside a block of code
 * does not split the note.
 */
export function splitSlides(source: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of source.split(/\r?\n/)) {
    if (FENCE.test(line)) inFence = !inFence;
    if (!inFence && SEPARATOR.test(line)) {
      blocks.push(current.join('\n'));
      current = [];
      continue;
    }
    current.push(line);
  }
  blocks.push(current.join('\n'));
  return blocks;
}

/** Builds the slide of a block of the note. */
function toSlide(block: string, index: number): Slide | null {
  const lines = block.split(/\r?\n/);
  const notesAt = lines.findIndex((line) => NOTES_MARKER.test(line));
  const bodyLines = notesAt < 0 ? lines : lines.slice(0, notesAt);
  const notes = notesAt < 0 ? '' : lines.slice(notesAt + 1).join('\n').trim();
  const body = bodyLines.join('\n').trim();
  if (body === '' && notes === '') return null;
  const { title, content } = splitTitle(bodyLines);
  return { index, title, content, notes };
}

/**
 * The title of a slide and the body that is left.
 *
 * The title is the first heading of the slide; a slide without a heading takes
 * its first non-empty line as its title.
 */
function splitTitle(lines: string[]): { title: string; content: string } {
  const headingAt = lines.findIndex((line) => /^\s*#{1,6}\s+\S/.test(line));
  if (headingAt >= 0) {
    const title = lines[headingAt].replace(/^\s*#{1,6}\s+/, '').trim();
    const content = lines.filter((_line, index) => index !== headingAt).join('\n').trim();
    return { title: shorten(title), content };
  }
  const firstAt = lines.findIndex((line) => line.trim() !== '');
  if (firstAt < 0) return { title: '', content: lines.join('\n').trim() };
  const title = lines[firstAt].trim();
  const content = lines.filter((_line, index) => index !== firstAt).join('\n').trim();
  return { title: shorten(title), content };
}

/** The title of a slide, cut at the end of its first line. */
function shorten(title: string): string {
  if (title.length <= MAX_TITLE) return title;
  return `${title.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}
