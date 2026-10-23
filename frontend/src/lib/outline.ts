// The extraction of the outline of a note.
//
// The outline is the list of the headings of the Markdown text. It is built
// from the raw text of the note (not from the rendered HTML), so it is cheap
// and works while the note is being edited.
import type { OutlineHeading } from '../components/OutlinePanel';

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
