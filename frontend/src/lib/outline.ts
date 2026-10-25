// The extraction of the outline of a note.
//
// The outline is the list of the headings of the Markdown text. It is built
// from the raw text of the note (not from the rendered HTML), so it is cheap
// and works while the note is being edited.
//
// The module is pure: it knows the Markdown, not the interface. The panel of
// the right column draws what these functions return.
import { compareStrings } from './ordering';

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

/** A heading of the outline, with the sections that live under it. */
export interface OutlineSection {
  heading: OutlineHeading;
  children: OutlineSection[];
}

/**
 * Builds the list of the headings of a Markdown text.
 *
 * Only the ATX headings (`#` … `######`) are taken: they are the ones that
 * have a stable anchor. The text of the heading is cleaned from the trailing
 * `#` characters and from the inline markup.
 */
export function extractHeadings(source: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  if (!source) return headings;

  let inFence = false;
  let fence = '';
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.trim();

    // A fenced block of code can contain a line that looks like a heading.
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!inFence) {
        inFence = true;
        fence = marker[0];
      } else if (marker[0] === fence) {
        inFence = false;
        fence = '';
      }
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (!match) continue;

    const level = match[1].length;
    const text = cleanHeadingText(match[2]);
    if (!text) continue;

    headings.push({ id: `h-${headings.length}-${slug(text)}`, text, level, line: index + 1 });
  }

  return headings;
}

/**
 * Builds the tree of the sections of an outline.
 *
 * A heading lives under the heading of the level just above it; a heading
 * whose level jumps (a level 3 under a level 1) lives under the last heading
 * of a lower level.
 */
export function outlineSections(headings: readonly OutlineHeading[]): OutlineSection[] {
  const roots: OutlineSection[] = [];
  const stack: OutlineSection[] = [];

  for (const heading of headings) {
    const section: OutlineSection = { heading, children: [] };
    const level = Math.max(1, heading.level);
    while (stack.length > 0 && stack[stack.length - 1]!.heading.level >= level) {
      stack.pop();
    }
    if (stack.length === 0) roots.push(section);
    else stack[stack.length - 1]!.children.push(section);
    stack.push(section);
  }

  return roots;
}

/**
 * The path of the active section: the identifiers of its ancestors and its own.
 *
 * The path is empty when no section is active. It is what the panel uses to
 * highlight the section the cursor is in and the way to it.
 */
export function activeSectionPath(
  sections: readonly OutlineSection[],
  activeId?: string | null,
): string[] {
  if (!activeId) return [];
  const walk = (list: readonly OutlineSection[], trail: string[]): string[] | null => {
    for (const section of list) {
      const next = [...trail, section.heading.id];
      if (section.heading.id === activeId) return next;
      const found = walk(section.children, next);
      if (found) return found;
    }
    return null;
  };
  return walk(sections, []) ?? [];
}

/** The number of the headings of an outline. */
export function outlineCount(headings: readonly OutlineHeading[]): number {
  return headings.length;
}

/** The headings of an outline, sorted by their text. */
export function outlineAlphabetically(headings: readonly OutlineHeading[]): OutlineHeading[] {
  return [...headings].sort((a, b) => compareStrings(a.text, b.text));
}

/** Removes the trailing `#` characters and the inline markup of a heading. */
function cleanHeadingText(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^_+(.*?)_+$/, '$1')
    .trim();
}

/** Builds a short anchor from the text of a heading. */
function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\u0400-\u04ff]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'x'
  );
}
