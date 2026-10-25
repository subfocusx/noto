import { describe, expect, it } from 'vitest';
import {
  applyTagSuggestion,
  filterTagSuggestions,
  parseTagToken,
} from '../lib/editor/tags';

describe('the token of a tag', () => {
  const cases: { name: string; text: string; caret: number; expected: string | null }[] = [
    { name: 'the caret is right behind the hash', text: 'a #', caret: 3, expected: '' },
    { name: 'the caret is inside the tag', text: 'a #work', caret: 5, expected: 'wo' },
    { name: 'the caret is behind the tag', text: 'a #work', caret: 7, expected: 'work' },
    { name: 'the tag stands at the start of the text', text: '#work', caret: 5, expected: 'work' },
    { name: 'the hash is a part of a word', text: 'a#work', caret: 6, expected: null },
    { name: 'there is no tag at all', text: 'plain text', caret: 5, expected: null },
    { name: 'the caret is before the tag', text: 'a #work', caret: 1, expected: null },
    { name: 'the tag follows a bracket', text: '(#work', caret: 6, expected: 'work' },
    { name: 'the caret is behind the text', text: '#work', caret: 99, expected: 'work' },
  ];

  for (const item of cases) {
    it(`parses the tag: ${item.name}`, () => {
      const token = parseTagToken(item.text, item.caret);
      if (item.expected === null) {
        expect(token).toBeNull();
        return;
      }
      expect(token).not.toBeNull();
      expect(token?.text).toBe(item.expected);
      expect(item.text.slice(token?.from ?? 0, token?.to ?? 0)).toBe(`#${item.expected}`);
    });
  }
});

describe('the list of the suggested tags', () => {
  it('offers the tags that start with the typed part first', () => {
    expect(filterTagSuggestions(['home', 'work', 'workshop'], 'wor')).toEqual(['work', 'workshop']);
  });

  it('offers the tags that only contain the typed part after them', () => {
    expect(filterTagSuggestions(['home', 'workshop'], 'shop')).toEqual(['workshop']);
  });

  it('offers every tag when nothing is typed yet', () => {
    expect(filterTagSuggestions(['home', 'work'], '')).toEqual(['home', 'work']);
  });

  it('does not care about the case', () => {
    expect(filterTagSuggestions(['Work'], 'wor')).toEqual(['Work']);
  });

  it('keeps the order of the list short', () => {
    const tags = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'];
    expect(filterTagSuggestions(tags, 'a', 3)).toEqual(['a1', 'a2', 'a3']);
  });

  it('offers nothing when no tag fits', () => {
    expect(filterTagSuggestions(['home'], 'zzz')).toEqual([]);
  });
});

describe('the insertion of a suggested tag', () => {
  it('replaces the typed part with the tag', () => {
    const text = 'a #wor';
    const token = parseTagToken(text, text.length);
    expect(token).not.toBeNull();
    const result = applyTagSuggestion(text, token!, 'work');
    expect(result.text).toBe('a #work ');
    expect(result.caret).toBe(8);
  });

  it('keeps the text behind the tag', () => {
    const text = 'a #wor and more';
    const token = parseTagToken(text, 6);
    const result = applyTagSuggestion(text, token!, 'work');
    expect(result.text).toBe('a #work  and more');
  });
});
