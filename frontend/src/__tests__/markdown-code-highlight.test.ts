import { describe, expect, it } from 'vitest';
import { highlightCode, languageProfile, tokenizeCode } from '../lib/markdown/codeHighlight';
import { renderMarkdown } from '../lib/markdown';

describe('the highlighter of the code blocks', () => {
  it('paints the keywords of a known language', () => {
    const html = highlightCode('const a = 1;', 'js');
    expect(html).toContain('class="noto-code-keyword"');
    expect(html).toContain('const');
  });

  it('paints the strings, the numbers and the comments', () => {
    const html = highlightCode('// note\nconst a = "text";\nlet b = 2;', 'javascript');
    expect(html).toContain('class="noto-code-comment"');
    expect(html).toContain('class="noto-code-string"');
    expect(html).toContain('class="noto-code-number"');
  });

  it('escapes the text of the code', () => {
    const html = highlightCode('<script>alert(1)</script>', 'js');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('leaves an unknown language as it is', () => {
    expect(languageProfile('brainfuck')).toBeNull();
    expect(highlightCode('const a', 'brainfuck')).toBe('const a');
  });

  it('splits the code into the tokens of the highlighter', () => {
    const tokens = tokenizeCode('let a = 1;', 'ts');
    expect(tokens.map((token) => token.kind)).toContain('keyword');
    expect(tokens.map((token) => token.kind)).toContain('number');
  });

  it('highlights the code block of the preview', () => {
    const html = renderMarkdown('```js\nconst a = 1;\n```');
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain('noto-code-keyword');
  });
});
