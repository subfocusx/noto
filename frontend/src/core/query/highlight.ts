/**
 * The highlighter of the query language: the ranges of the text of a note
 * that satisfy the condition of the query.
 *
 * Only the conditions about the content of the note have a range in the
 * text; the other fields live outside of the text and give no range.
 */

import type { QueryNode, QueryValue } from './ir';

/** A range of the text of a note. */
export interface MatchRange {
  /** The first character of the range. */
  from: number;
  /** The character after the last one of the range. */
  to: number;
}

/**
 * The ranges of the text that match the condition.
 *
 * @param content The text of the note.
 * @param ast The compiled query.
 * @param nowSeconds The moment of the execution (unused for the text, kept
 * for the symmetry with the predicate).
 */
export function matchRanges(
  content: string,
  ast: QueryNode | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): MatchRange[] {
  void nowSeconds;
  const ranges: MatchRange[] = [];

  const walk = (node: QueryNode): void => {
    switch (node.k) {
      case 'and':
      case 'or':
        walk(node.l);
        walk(node.r);
        return;
      case 'not':
        walk(node.e);
        return;
      case 'truthy':
        return;
      case 'cmp':
        collect(node.f, node.op, node.v);
        return;
      default:
        return;
    }
  };

  const collect = (field: string, op: string, value: QueryValue): void => {
    if (field !== 'content') return;
    if (value.k !== 'str') return;
    const needle = value.v;
    if (needle === '') return;
    const haystack = content.toLowerCase();
    const lowerNeedle = needle.toLowerCase();

    if (op === 'contains') {
      let from = haystack.indexOf(lowerNeedle);
      while (from >= 0) {
        ranges.push({ from, to: from + needle.length });
        from = haystack.indexOf(lowerNeedle, from + needle.length);
      }
      return;
    }
    if (op === 'startsWith') {
      if (haystack.startsWith(lowerNeedle)) {
        ranges.push({ from: 0, to: needle.length });
      }
      return;
    }
    if (op === 'endsWith') {
      if (haystack.endsWith(lowerNeedle)) {
        ranges.push({ from: content.length - needle.length, to: content.length });
      }
      return;
    }
    if (op === '==') {
      if (haystack === lowerNeedle) {
        ranges.push({ from: 0, to: content.length });
      }
    }
  };

  if (ast !== null) walk(ast);

  return merge(ranges);
}

/**
 * Sorts the ranges and merges the overlapping ones.
 */
function merge(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length === 0) return ranges;
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: MatchRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.from <= last.to) {
      last.to = Math.max(last.to, range.to);
      continue;
    }
    out.push({ from: range.from, to: range.to });
  }
  return out;
}
