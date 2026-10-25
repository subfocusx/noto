import { describe, expect, it } from 'vitest';
import { computeMatchRanges, pickCurrentMatch } from '../lib/editor/matchRanges';

describe('the ranges of the matches', () => {
  it('finds every occurrence of the needle', () => {
    expect(computeMatchRanges('the cat and the cat', 'cat')).toEqual([
      { from: 4, to: 7 },
      { from: 16, to: 19 },
    ]);
  });

  it('does not care about the case', () => {
    expect(computeMatchRanges('a Cat here', 'cat')).toEqual([{ from: 2, to: 5 }]);
  });

  it('matches nothing when the needle is empty', () => {
    expect(computeMatchRanges('the cat', '')).toEqual([]);
  });

  it('matches nothing when the text does not hold the needle', () => {
    expect(computeMatchRanges('the cat', 'dog')).toEqual([]);
  });

  it('does not match the needle inside itself', () => {
    expect(computeMatchRanges('aaaa', 'aa')).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  it('picks the match the caret is in', () => {
    const ranges = computeMatchRanges('the cat and the cat', 'cat');
    expect(pickCurrentMatch(ranges, 5)).toBe(0);
    expect(pickCurrentMatch(ranges, 17)).toBe(1);
  });

  it('picks the first match after the caret', () => {
    const ranges = computeMatchRanges('the cat and the cat', 'cat');
    expect(pickCurrentMatch(ranges, 0)).toBe(0);
    expect(pickCurrentMatch(ranges, 10)).toBe(1);
  });

  it('picks the last match when the caret is behind them all', () => {
    const ranges = computeMatchRanges('the cat and the cat', 'cat');
    expect(pickCurrentMatch(ranges, 999)).toBe(1);
  });

  it('has no current match without a range', () => {
    expect(pickCurrentMatch([], 0)).toBe(-1);
  });
});
