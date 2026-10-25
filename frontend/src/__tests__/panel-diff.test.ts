// The tests of the diff of two versions of a note.
//
// The difference between two versions is computed by a pure module: the tests
// give it two texts and read the rows of the interface back.
import { describe, expect, it } from 'vitest';
import {
  buildDiffRows,
  diffAgainstPrevious,
  diffLines,
  diffOfTexts,
  diffStats,
} from '../core/views/diff';

describe('the diff of two texts', () => {
  it('keeps the lines that did not change', () => {
    const lines = diffLines('one\ntwo', 'one\ntwo');
    expect(lines).toEqual([
      { kind: 'context', text: 'one', fromLine: 1, toLine: 1 },
      { kind: 'context', text: 'two', fromLine: 2, toLine: 2 },
    ]);
  });

  it('marks the line that was added', () => {
    const lines = diffLines('one', 'one\ntwo');
    expect(lines[lines.length - 1]).toEqual({
      kind: 'added',
      text: 'two',
      fromLine: 0,
      toLine: 2,
    });
  });

  it('marks the line that was removed', () => {
    const lines = diffLines('one\ntwo', 'one');
    expect(lines[lines.length - 1]).toEqual({
      kind: 'removed',
      text: 'two',
      fromLine: 2,
      toLine: 0,
    });
  });

  it('puts a removed line and an added line next to each other', () => {
    const rows = diffOfTexts('one\ntwo', 'one\nthree');
    const changed = rows.find((row) => row.kind === 'changed');
    expect(changed?.left?.text).toBe('two');
    expect(changed?.right?.text).toBe('three');
  });

  it('counts the lines that were added and removed', () => {
    const rows = diffOfTexts('one\ntwo', 'one\nthree\nfour');
    expect(diffStats(rows)).toEqual({ added: 2, removed: 1 });
  });

  it('shows a line that is only on one side', () => {
    const rows = buildDiffRows(diffLines('one', 'one\ntwo'));
    const added = rows.find((row) => row.kind === 'added');
    expect(added?.left).toBeUndefined();
    expect(added?.right?.text).toBe('two');
  });

  it('gives an empty diff for two empty texts', () => {
    expect(diffLines('', '')).toEqual([]);
    expect(diffOfTexts('', '')).toEqual([]);
  });

  it('diffs a version against the version before it', () => {
    const versions = [{ content: 'one' }, { content: 'one\ntwo' }];
    const rows = diffAgainstPrevious(versions, 1);
    expect(rows[rows.length - 1]?.right?.text).toBe('two');
  });

  it('gives no diff for the first version', () => {
    expect(diffAgainstPrevious([{ content: 'one' }], 0)).toEqual([]);
  });
});
