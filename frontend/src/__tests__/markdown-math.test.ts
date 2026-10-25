import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../lib/markdown';

describe('the formulas of the preview', () => {
  it('renders a formula inside a line', () => {
    const html = renderMarkdown('the value $x^2$ is here');
    expect(html).toContain('class="noto-math-inline"');
    expect(html).toContain('x^2');
  });

  it('renders a formula that stands on its own lines', () => {
    const html = renderMarkdown('$$\nE = mc^2\n$$');
    expect(html).toContain('noto-math-block');
    expect(html).toContain('E = mc^2');
  });

  it('does not take the money for a formula', () => {
    const html = renderMarkdown('it costs $5 and $10');
    expect(html).not.toContain('noto-math');
    expect(html).toContain('$5');
  });

  it('escapes the content of a formula', () => {
    const html = renderMarkdown('a $<script>alert(1)</script>$ b');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('leaves the code of a code span alone', () => {
    const html = renderMarkdown('write `$x$` in the text');
    expect(html).not.toContain('noto-math');
    expect(html).toContain('<code>$x$</code>');
  });

  it('does not let a formula run over the next one', () => {
    const html = renderMarkdown('$a$ and $b$');
    expect(html).toContain('noto-math-inline');
    expect(html).not.toContain('noto-math-block');
  });
});
