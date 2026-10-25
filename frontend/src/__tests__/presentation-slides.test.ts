// The tests of the slides of a presentation.
//
// The rules of the Markdown of a presentation live in the file of the slides:
// a line of three or more dashes splits the note into slides.
import { describe, expect, it } from 'vitest';
import { parsePresentation, splitSlides } from '../core/presentations/slides';

const NOTE = [
  '# The road',
  '',
  'The first slide.',
  '',
  '---',
  '',
  '# The map',
  '',
  'The second slide.',
  '',
  '???',
  'The notes of the speaker.',
].join('\n');

describe('the slides of a presentation', () => {
  it('reads no presentation out of an ordinary note', () => {
    expect(parsePresentation('# A note\n\nWith a text.')).toBeNull();
  });

  it('splits the note at the separators', () => {
    expect(splitSlides('one\n---\ntwo')).toHaveLength(2);
  });

  it('reads the slides of a note', () => {
    const presentation = parsePresentation(NOTE);

    expect(presentation).not.toBeNull();
    expect(presentation?.slides).toHaveLength(2);
    expect(presentation?.title).toBe('The road');
    expect(presentation?.slides[0].title).toBe('The road');
    expect(presentation?.slides[0].content).toContain('The first slide.');
    expect(presentation?.slides[0].content).not.toContain('# The road');
  });

  it('keeps the notes of the speaker out of the slide', () => {
    const presentation = parsePresentation(NOTE);

    expect(presentation?.slides[1].title).toBe('The map');
    expect(presentation?.slides[1].notes).toBe('The notes of the speaker.');
    expect(presentation?.slides[1].content).not.toContain('notes of the speaker');
  });

  it('takes the first line of a slide without a heading as its title', () => {
    const presentation = parsePresentation('Just a line\n\n---\n\n# Other');

    expect(presentation?.slides[0].title).toBe('Just a line');
  });

  it('does not split the note at a line of dashes inside a code block', () => {
    const source = ['# One', '', '```', '---', '```', '', '---', '', '# Two'].join('\n');
    const presentation = parsePresentation(source);

    expect(presentation?.slides).toHaveLength(2);
    expect(presentation?.slides[0].content).toContain('---');
  });
});
