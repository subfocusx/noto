// The diff of two versions of a note.
//
// The history of a note is a list of versions: the content of the note at
// every moment it was written. The user wants to see what changed between two
// of them.
//
// The module is pure: it reads two texts and gives the lines of the
// interface. The same module serves the diff the server computes and the diff
// the browser computes in the encrypted vault, where the server never sees
// the text of the note.

/** The kind of a line of a diff. */
export type DiffKind = 'context' | 'added' | 'removed';

/** The kind of a row of the interface: a line that changed is on both sides. */
export type DiffRowKind = DiffKind | 'changed';

/** One line of a diff. */
export interface DiffLine {
  kind: DiffKind;
  /** The text of the line. */
  text: string;
  /** The number of the line in the text before the change (0 when it is new). */
  fromLine: number;
  /** The number of the line in the text after the change (0 when it is gone). */
  toLine: number;
}

/** One side of a row of the interface. */
export interface DiffSide {
  /** The number of the line on this side. */
  line: number;
  /** The text of the line. */
  text: string;
}

/** One row of the interface: the left side and the right side of the change. */
export interface DiffRow {
  kind: DiffRowKind;
  /** The line of the text before the change. */
  left?: DiffSide;
  /** The line of the text after the change. */
  right?: DiffSide;
}

/** The number of the lines above which the diff gives up and shows everything. */
const MAX_DIFF_CELLS = 1_000_000;

/**
 * The lines of two texts, line by line.
 *
 * The common lines are kept (they are the context), the lines that are only
 * in the first text are removed and the lines that are only in the second one
 * are added.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = splitLines(before);
  const right = splitLines(after);

  if (left.length * right.length > MAX_DIFF_CELLS) {
    // Two very long texts: the exact diff would cost too much memory, so the
    // whole text is shown as removed and the whole text as added.
    return [
      ...left.map((text, index) => ({ kind: 'removed' as const, text, fromLine: index + 1, toLine: 0 })),
      ...right.map((text, index) => ({ kind: 'added' as const, text, fromLine: 0, toLine: index + 1 })),
    ];
  }

  const table = lcsTable(left, right);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      lines.push({ kind: 'context', text: left[i]!, fromLine: i + 1, toLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: 'removed', text: left[i]!, fromLine: i + 1, toLine: 0 });
      i += 1;
    } else {
      lines.push({ kind: 'added', text: right[j]!, fromLine: 0, toLine: j + 1 });
      j += 1;
    }
  }
  while (i < left.length) {
    lines.push({ kind: 'removed', text: left[i]!, fromLine: i + 1, toLine: 0 });
    i += 1;
  }
  while (j < right.length) {
    lines.push({ kind: 'added', text: right[j]!, fromLine: 0, toLine: j + 1 });
    j += 1;
  }

  return lines;
}

/**
 * The rows of the interface: the removed lines and the added lines stand next
 * to each other, so that the user reads the change as one row.
 */
export function buildDiffRows(lines: readonly DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    if (line.kind === 'context') {
      rows.push({
        kind: 'context',
        left: { line: line.fromLine, text: line.text },
        right: { line: line.toLine, text: line.text },
      });
      index += 1;
      continue;
    }

    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (index < lines.length && lines[index]!.kind === 'removed') {
      removed.push(lines[index]!);
      index += 1;
    }
    while (index < lines.length && lines[index]!.kind === 'added') {
      added.push(lines[index]!);
      index += 1;
    }

    const count = Math.max(removed.length, added.length);
    for (let row = 0; row < count; row += 1) {
      const before = removed[row];
      const after = added[row];
      rows.push({
        kind: before && after ? 'changed' : before ? 'removed' : 'added',
        left: before ? { line: before.fromLine, text: before.text } : undefined,
        right: after ? { line: after.toLine, text: after.text } : undefined,
      });
    }
  }

  return rows;
}

/** The diff of two texts, as the rows of the interface. */
export function diffOfTexts(before: string, after: string): DiffRow[] {
  return buildDiffRows(diffLines(before, after));
}

/** The number of the lines that were added and removed by a diff. */
export function diffStats(rows: readonly DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === 'added' || row.kind === 'changed') added += 1;
    if (row.kind === 'removed' || row.kind === 'changed') removed += 1;
  }
  return { added, removed };
}

/**
 * The diff of a version of a note against the version that came before it.
 *
 * The versions are given from the oldest to the newest, as the storage lists
 * them. The first version has nothing before it: the diff is empty.
 */
export function diffAgainstPrevious(
  versions: readonly { content: string }[],
  index: number,
): DiffRow[] {
  if (index <= 0) return [];
  const previous = versions[index - 1];
  const current = versions[index];
  if (!previous || !current) return [];
  return diffOfTexts(previous.content, current.content);
}

/** Splits a text into its lines, without the line breaks. */
function splitLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/** The table of the longest common subsequence of two lists of lines. */
function lcsTable(left: readonly string[], right: readonly string[]): number[][] {
  const table: number[][] = [];
  for (let i = 0; i <= left.length; i += 1) table.push(new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        left[i] === right[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}
