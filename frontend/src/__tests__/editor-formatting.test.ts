// The tests of the formatting of the text of a note.
//
// The toolbar of the editor does not write rich text: it puts the Markdown
// syntax around the selection. The functions are pure, so the tests do not
// need a browser.
import { describe, expect, it } from 'vitest';
import {
  BOLD,
  ITALIC,
  UNDERLINE,
  lineRange,
  makeLink,
  prefixLines,
  toggleWrap,
} from '../core/editor/formatting';

describe('the inline formats', () => {
  it('wraps the selection with the marker', () => {
    const edit = toggleWrap('hello world', 6, 11, BOLD);

    expect(edit.text).toBe('hello **world**');
    expect(edit.text.slice(edit.from, edit.to)).toBe('world');
  });

  it('unwraps a selection that is already wrapped', () => {
    const edit = toggleWrap('hello **world**', 6, 15, BOLD);

    expect(edit.text).toBe('hello world');
  });

  it('puts the cursor between the markers of an empty selection', () => {
    const edit = toggleWrap('hello', 5, 5, ITALIC);

    expect(edit.text).toBe('hello**');
    expect(edit.from).toBe(6);
    expect(edit.to).toBe(6);
  });

  it('underlines with the HTML, because Markdown has no underline', () => {
    const edit = toggleWrap('word', 0, 4, UNDERLINE);

    expect(edit.text).toBe('<u>word</u>');
  });
});

describe('the formats of the line', () => {
  it('finds the whole line of the selection', () => {
    const range = lineRange('one\ntwo\nthree', 5, 6);

    expect(range.from).toBe(4);
    expect(range.to).toBe(7);
  });

  it('puts the heading at the beginning of the line', () => {
    const edit = prefixLines('one\ntwo', 0, 7, '# ', true);

    expect(edit.text).toBe('# one\n# two');
  });

  it('replaces the heading that the line already has', () => {
    const edit = prefixLines('## title', 0, 7, '# ', true);

    expect(edit.text).toBe('# title');
  });

  it('numbers the lines of a list', () => {
    const edit = prefixLines('one\ntwo', 0, 7, '1. ');

    expect(edit.text).toBe('1. one\n2. two');
  });

  it('replaces the marker of the list that the line already has', () => {
    const edit = prefixLines('- one', 0, 5, '- ');

    expect(edit.text).toBe('- one');
  });

  it('quotes the line', () => {
    const edit = prefixLines('text', 0, 4, '> ');

    expect(edit.text).toBe('> text');
  });
});

describe('the link', () => {
  it('turns the selection into a link', () => {
    const edit = makeLink('see the site', 4, 12);

    expect(edit.text).toBe('see [the site]()');
  });

  it('puts the cursor between the brackets of an empty selection', () => {
    const edit = makeLink('see', 3, 3);

    expect(edit.text).toBe('see[]()');
    expect(edit.from).toBe(4);
  });
});
