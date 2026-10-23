import { describe, expect, it } from 'vitest';
import { extractHeadings } from '../lib/outline';

describe('the outline of a note', () => {
  it('collects the headings with their level', () => {
    const headings = extractHeadings('# One\n\ntext\n\n## Two\n\n### Three\n');
    expect(headings.map((h) => h.text)).toEqual(['One', 'Two', 'Three']);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3]);
  });

  it('removes the inline markup of a heading', () => {
    const headings = extractHeadings('## The **bold** `code` [link](http://x)');
    expect(headings[0]?.text).toBe('The bold code link');
  });

  it('removes the closing hashes of a heading', () => {
    const headings = extractHeadings('## Closed ##');
    expect(headings[0]?.text).toBe('Closed');
  });

  it('ignores the headings inside a fenced block of code', () => {
    const headings = extractHeadings('# Real\n\n```\n# Not a heading\n```\n\n## Also real\n');
    expect(headings.map((h) => h.text)).toEqual(['Real', 'Also real']);
  });

  it('ignores the headings of a tilde fence', () => {
    const headings = extractHeadings('~~~\n# Hidden\n~~~\n');
    expect(headings).toHaveLength(0);
  });

  it('reports the line of every heading', () => {
    const headings = extractHeadings('first\n\n# Second\n\n# Third\n');
    expect(headings[0]?.line).toBe(3);
    expect(headings[1]?.line).toBe(5);
  });

  it('gives every heading its own identifier', () => {
    const headings = extractHeadings('# Same\n\n# Same\n');
    expect(headings[0]?.id).not.toBe(headings[1]?.id);
  });

  it('returns nothing for an empty note', () => {
    expect(extractHeadings('')).toEqual([]);
  });
});
