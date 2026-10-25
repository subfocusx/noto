import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../lib/markdown';

describe('the footnotes of the preview', () => {
  it('renders the reference and the list of the footnotes', () => {
    const html = renderMarkdown('the claim[^a]\n\n[^a]: the source of the claim');
    expect(html).toContain('noto-footnote-ref');
    expect(html).toContain('noto-footnotes');
    expect(html).toContain('the source of the claim');
  });

  it('numbers the footnotes in the order of the references', () => {
    const html = renderMarkdown('one[^b] two[^a]\n\n[^a]: second\n[^b]: first');
    expect(html).toContain('>1</a>');
    expect(html).toContain('>2</a>');
  });

  it('leaves no trace of the definition where it is written', () => {
    const html = renderMarkdown('[^a]: only a definition');
    expect(html).not.toContain('<p>[^a]');
    expect(html).toContain('noto-footnotes');
    expect(html).toContain('only a definition');
  });

  it('escapes the text of a footnote', () => {
    const html = renderMarkdown('text[^a]\n\n[^a]: <script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('keeps a note without a footnote untouched', () => {
    const html = renderMarkdown('# Title\n\ntext');
    expect(html).not.toContain('noto-footnotes');
  });
});
