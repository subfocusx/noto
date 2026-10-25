// The footnotes of the preview.
//
// A footnote is written as a reference `[^name]` in the text and as a
// definition `[^name]: the text of the footnote` in the note. The references
// become the numbers of the footnotes, and the definitions leave the place
// where they are written and come back as a list at the end of the note.
//
// The definitions are single line: a definition that spans several lines is
// a definition and the rest of its lines.

import type { TokenizerAndRendererExtension } from 'marked';
import { t } from '../../i18n';
import { escapeHtml } from './escape';

/** The definition of a footnote, at the beginning of a line. */
const DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;

/** The reference to a footnote. */
const REFERENCE = /^\[\^([^\]\s]+)\]/;

/** A footnote of a note. */
export interface Footnote {
  /** The name of the footnote, the part between the brackets. */
  id: string;
  /** The text of the footnote. */
  text: string;
  /** The number of the footnote, counted from one. */
  number: number;
}

/** The footnotes of one rendering. */
export interface FootnoteCollector {
  /** The definitions, by name. */
  definitions: Map<string, Footnote>;
  /** The names of the footnotes, in the order of their first reference. */
  order: string[];
}

/** Creates an empty collector of the footnotes. */
export function createFootnoteCollector(): FootnoteCollector {
  return { definitions: new Map(), order: [] };
}

/** The collector of the rendering that is running, if there is one. */
let active: FootnoteCollector | null = null;

/**
 * Starts the collection of the footnotes.
 *
 * The collection is bound to one rendering: marked renders the note in one
 * go, so one collector is enough.
 */
export function startFootnoteCollection(): FootnoteCollector {
  const collector = createFootnoteCollector();
  active = collector;
  return collector;
}

/** Stops the collection of the footnotes. */
export function stopFootnoteCollection(): void {
  active = null;
}

/**
 * Notes a token of the rendering.
 *
 * The references get their number in the order of their first appearance;
 * the definitions are remembered, so the list at the end can be built.
 */
export function collectFootnoteToken(token: { type?: string; id?: string; text?: string }): void {
  const collector = active;
  if (!collector) return;
  if (token.type === 'footnoteReference' && typeof token.id === 'string') {
    if (!collector.order.includes(token.id)) collector.order.push(token.id);
    const number = collector.order.indexOf(token.id) + 1;
    const definition = collector.definitions.get(token.id);
    if (definition) definition.number = number;
    (token as { number?: number }).number = number;
    return;
  }
  if (token.type === 'footnoteDefinition' && typeof token.id === 'string') {
    const number = collector.order.includes(token.id)
      ? collector.order.indexOf(token.id) + 1
      : collector.definitions.size + 1;
    collector.definitions.set(token.id, {
      id: token.id,
      text: typeof token.text === 'string' ? token.text : '',
      number,
    });
  }
}

/** The name of a footnote, safe to put into an attribute of the HTML. */
function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-');
}

/**
 * The list of the footnotes, as HTML.
 *
 * An empty string when the note holds no footnote.
 */
export function renderFootnotes(
  collector: FootnoteCollector,
  renderText?: (text: string) => string,
): string {
  const ids = collector.order.filter((id) => collector.definitions.has(id));
  for (const id of collector.definitions.keys()) {
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return '';
  const items = ids.map((id, index) => {
    const footnote = collector.definitions.get(id) as Footnote;
    const safe = safeId(id);
    const number = index + 1;
    const text = renderText ? renderText(footnote.text) : escapeHtml(footnote.text);
    return (
      `<li id="noto-fn-${safe}" class="noto-footnote">` +
      `<span class="noto-footnote-number">${number}.</span> ` +
      `<span class="noto-footnote-text">${text}</span> ` +
      `<a class="noto-footnote-back" href="#noto-fnref-${safe}" aria-label="${t('markdown.footnoteBack')}">↩</a>` +
      '</li>'
    );
  });
  return (
    `<section class="noto-footnotes" aria-label="${t('markdown.footnotes')}">` +
    `<ol class="noto-footnotes-list">${items.join('')}</ol>` +
    '</section>'
  );
}

/**
 * The extensions of marked that render the footnotes.
 *
 * The definition leaves no trace where it is written: the list of the
 * footnotes is built at the end of the note.
 */
export function footnoteExtensions(): TokenizerAndRendererExtension[] {
  return [
    {
      name: 'footnoteDefinition',
      level: 'block',
      start(src) {
        const index = src.indexOf('[^');
        return index < 0 ? undefined : index;
      },
      tokenizer(src) {
        const match = DEFINITION.exec(src);
        if (!match) return undefined;
        const id = match[1] as string;
        const text = match[2] as string;
        return { type: 'footnoteDefinition', raw: match[0], id, text };
      },
      renderer() {
        return '';
      },
    },
    {
      name: 'footnoteReference',
      level: 'inline',
      start(src) {
        const index = src.indexOf('[^');
        return index < 0 ? undefined : index;
      },
      tokenizer(src) {
        const match = REFERENCE.exec(src);
        if (!match) return undefined;
        return { type: 'footnoteReference', raw: match[0], id: match[1] as string };
      },
      renderer(token) {
        const id = String((token as { id?: string }).id ?? '');
        const number = Number((token as { number?: number }).number ?? 0);
        const safe = safeId(id);
        return (
          `<sup class="noto-footnote-ref">` +
          `<a id="noto-fnref-${safe}" href="#noto-fn-${safe}">${number}</a>` +
          '</sup>'
        );
      },
    },
  ];
}
