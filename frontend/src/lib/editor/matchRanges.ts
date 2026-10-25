// The ranges of the text of a note that match a needle.
//
// The editor is a CodeMirror view, so the matches are not painted by hand:
// the ranges are computed here and the view turns them into decorations.
// The computation is pure, so it can be tested without a browser.

/** A range of the text of a note. */
export interface TextRange {
  /** The first character of the range. */
  from: number;
  /** The character after the last one of the range. */
  to: number;
}

/**
 * The ranges of the text that contain the needle.
 *
 * The search is case insensitive, like the search of the backend. An empty
 * needle matches nothing: a range of length zero would be invisible and
 * would only slow the editor down.
 */
export function computeMatchRanges(text: string, needle: string): TextRange[] {
  if (needle === '') return [];
  const haystack = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const ranges: TextRange[] = [];
  let from = haystack.indexOf(lowerNeedle);
  while (from >= 0) {
    ranges.push({ from, to: from + needle.length });
    from = haystack.indexOf(lowerNeedle, from + needle.length);
  }
  return ranges;
}

/**
 * The index of the range that is the current one.
 *
 * The current match is the range the caret is in, or the first range after
 * the caret. When the caret is behind every range, the last one is current:
 * the search of the editor walks through the matches and comes back.
 *
 * @returns the index of the range, or `-1` when there is no range at all.
 */
export function pickCurrentMatch(ranges: TextRange[], caret: number): number {
  if (ranges.length === 0) return -1;
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index] as TextRange;
    if (range.from <= caret && caret <= range.to) return index;
  }
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index] as TextRange;
    if (range.from > caret) return index;
  }
  return ranges.length - 1;
}
