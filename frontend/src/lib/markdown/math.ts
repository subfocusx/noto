// The formulas of the preview.
//
// The formulas are written with the delimiters of the TeX (`$…$` and `$$…$$`),
// but they are not parsed by a TeX engine: the highlighter of the preview
// shows the formula as it is written. The syntax is therefore small and is
// documented here:
//
//   * `$x^2$` — a formula inside a line;
//   * `$$ … $$` — a formula that stands on its own lines;
//   * the content may not begin or end with a space, so the money
//     (`$5`) is not a formula;
//   * the content may not hold a `$`, so the formula never runs over the
//     next one.
//
// The content is escaped before it reaches the HTML: a formula can never
// carry markup into the preview.

import type { MarkedExtension } from 'marked';
import { escapeHtml } from './escape';

/** The formula inside a line. */
const INLINE_MATH = /^\$([^$\n]+?)\$/;

/** The formula that stands on its own lines. */
const BLOCK_MATH = /^\$\$([\s\S]+?)\$\$(?:\n+|$)/;

/**
 * True when the content of a formula is a formula.
 *
 * The content may not be empty and may not begin or end with a space.
 */
export function isMathContent(content: string): boolean {
  if (content.trim() === '') return false;
  return !/^\s/.test(content) && !/\s$/.test(content);
}

/**
 * The extension of marked that renders the formulas.
 *
 * The extension is a tokenizer and a renderer of marked: the text of the
 * formula never enters the source of the markdown, so no raw HTML is
 * injected into the note.
 */
export function mathExtension(): MarkedExtension {
  return {
    extensions: [
      {
        name: 'notoMathInline',
        level: 'inline',
        start(src) {
          const index = src.indexOf('$');
          return index < 0 ? undefined : index;
        },
        tokenizer(src) {
          const match = INLINE_MATH.exec(src);
          if (!match) return undefined;
          const content = match[1] as string;
          if (!isMathContent(content)) return undefined;
          return { type: 'notoMathInline', raw: match[0], text: content };
        },
        renderer(token) {
          const content = escapeHtml(String((token as { text?: string }).text ?? ''));
          return `<span class="noto-math-inline" data-noto-math="inline">${content}</span>`;
        },
      },
      {
        name: 'notoMathBlock',
        level: 'block',
        start(src) {
          const index = src.indexOf('$$');
          return index < 0 ? undefined : index;
        },
        tokenizer(src) {
          const match = BLOCK_MATH.exec(src);
          if (!match) return undefined;
          return { type: 'notoMathBlock', raw: match[0], text: (match[1] as string).trim() };
        },
        renderer(token) {
          const content = escapeHtml(String((token as { text?: string }).text ?? ''));
          return `<div class="noto-math-block" data-noto-math="block">${content}</div>`;
        },
      },
    ],
  };
}
