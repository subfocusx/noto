import { describe, expect, it } from 'vitest';
import { renderSafeMarkdown, renderMarkdown } from '../lib/markdown';
import { createWikiResolver } from '../lib/wiki';
import type { Node } from '../types';

function node(path: string, name: string): Node {
  return {
    id: path,
    name,
    path,
    type: 'file',
    parentPath: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

describe('the sound in the preview', () => {
  it('shows a player for a recording', () => {
    const html = renderMarkdown('![Recording 2026-10-25 16:28 (0:05)](/api/attachments/att-1/raw?type=audio)');

    expect(html).toContain('<audio');
    expect(html).toContain('controls');
    expect(html).toContain('/api/attachments/att-1/raw?type=audio');
    // The picture is not shown: the sound is not a picture.
    expect(html).not.toContain('<img');
  });

  it('keeps the pictures as pictures', () => {
    const html = renderMarkdown('![photo](/api/attachments/att-2/raw)');

    expect(html).toContain('<img');
    expect(html).not.toContain('<audio');
  });
});

describe('markdown sanitization', () => {
  it('removes script tags', () => {
    const html = renderMarkdown('# hi\n\n<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('removes inline event handlers', () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('removes javascript: urls', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  it('keeps regular markdown formatting', () => {
    const html = renderMarkdown('# Title\n\n**bold**');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('adds rel=noopener noreferrer to external links', () => {
    const html = renderSafeMarkdown('[site](https://example.com)');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('never rewrites the source text of the note', () => {
    const source = 'Ünïcödé Привет [[Wiki]]';
    const html = renderMarkdown(source);
    expect(html).toContain('Ünïcödé');
    expect(html).toContain('Привет');
  });

  it('removes iframes', () => {
    const html = renderMarkdown('<iframe src="https://evil.example"></iframe>');
    expect(html.toLowerCase()).not.toContain('<iframe');
  });

  it('removes inline event handlers of other elements', () => {
    const html = renderMarkdown('<div onclick="steal()">x</div>');
    expect(html.toLowerCase()).not.toContain('onclick');
    expect(html).not.toContain('steal()');
  });

  it('adds rel=noopener noreferrer to protocol relative links', () => {
    const html = renderSafeMarkdown('[x](//evil.example/p)');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('wiki links', () => {
  it('links a matching note', () => {
    const resolve = createWikiResolver([node('a/other.md', 'other.md'), node('b/target.md', 'target.md')]);
    const html = renderMarkdown('see [[target]]', resolve);
    expect(html).toContain('class="wikilink"');
    expect(html).toContain('data-noto-path="b/target.md"');
  });

  it('renders unmatched links as plain text', () => {
    const resolve = createWikiResolver([node('b/target.md', 'target.md')]);
    const html = renderMarkdown('see [[missing]]', resolve);
    expect(html).not.toContain('wikilink');
    expect(html).toContain('missing');
  });

  it('resolves duplicates by path order (first match wins)', () => {
    const resolve = createWikiResolver([node('z/target.md', 'target.md'), node('a/target.md', 'target.md')]);
    expect(resolve('target')).toBe('a/target.md');
  });

  it('matches the name without the .md suffix', () => {
    const resolve = createWikiResolver([node('journal/2026.md', '2026.md')]);
    expect(resolve('2026')).toBe('journal/2026.md');
  });

  it('resolves a link that addresses the full path of a note', () => {
    const resolve = createWikiResolver([node('journal/2026.md', '2026.md')]);
    expect(resolve('journal/2026.md')).toBe('journal/2026.md');
  });

  it('leaves an unknown link unresolved', () => {
    const resolve = createWikiResolver([node('journal/2026.md', '2026.md')]);
    expect(resolve('nothing')).toBeNull();
  });
});
