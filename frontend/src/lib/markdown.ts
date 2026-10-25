// Markdown preview rendering: marked -> DOMPurify -> safe HTML.
//
// The renderer knows a few things more than the plain markdown: the
// formulas (`$…$`), the footnotes (`[^1]`) and the highlighted code blocks.
// Every one of them goes through marked and through DOMPurify, so no raw
// HTML of the user ever reaches the preview.
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { WIKI_LINK_RE, type WikiResolver } from './wiki';
import { escapeHtml } from './markdown/escape';
import { highlightCode } from './markdown/codeHighlight';
import {
  collectFootnoteToken,
  footnoteExtensions,
  renderFootnotes,
  startFootnoteCollection,
  stopFootnoteCollection,
} from './markdown/footnotes';
import { mathExtension } from './markdown/math';
import { isAudioUrl } from './attachments';
import { recordingDuration } from './audioReferences';
import { t } from '../i18n';

marked.setOptions({ gfm: true, breaks: true });

marked.use({
  extensions: [...(mathExtension().extensions ?? []), ...footnoteExtensions()],
  walkTokens: (token) => {
    collectFootnoteToken(token as { type?: string; id?: string; text?: string });
  },
  renderer: {
    code(code: string, infostring: string | undefined): string {
      const language = (infostring ?? '').trim();
      const highlighted = highlightCode(code, language);
      const attribute = language ? ` class="language-${escapeHtml(language)}"` : '';
      return `<pre><code${attribute}>${highlighted}</code></pre>`;
    },
    image(href: string | null, title: string | null, text: string): string {
      // A recording of the sound is a link to the bytes of the attachment:
      // the preview shows a player instead of a broken picture.
      if (isAudioUrl(href)) {
        const name = title ?? text ?? '';
        const duration = recordingDuration(name);
        // The caption names the sound instead of showing the Markdown of the
        // reference: the reader sees what it is and how long it is.
        const caption = duration ? `${t('editor.audio.label')} · ${duration}` : t('editor.audio.label');
        const nameAttribute = name ? ` title="${escapeHtml(name)}"` : '';
        return `<span class="noto-audio"><span class="noto-audio-caption"${nameAttribute}>${escapeHtml(caption)}</span><audio controls preload="metadata" src="${escapeHtml(href ?? '')}"></audio></span>`;
      }
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(href ?? '')}" alt="${escapeHtml(text ?? '')}"${titleAttribute}>`;
    },
  },
});

export { escapeHtml };

/**
 * Replaces [[Wiki]] links with an anchor when the target resolves,
 * otherwise with plain text.
 */
export function applyWikiLinks(source: string, resolve: WikiResolver | null): string {
  return source.replace(WIKI_LINK_RE, (_match, rawTarget: string) => {
    const target = rawTarget.trim();
    if (!resolve) return escapeHtml(target);
    const path = resolve(target);
    if (!path) return escapeHtml(target);
    const href = `#/note/${encodeURIComponent(path)}`;
    return `<a class="wikilink" data-noto-path="${escapeHtml(path)}" href="${escapeHtml(href)}">${escapeHtml(target)}</a>`;
  });
}

/**
 * Renders markdown to sanitized HTML.
 * Always sanitized: scripts, event handlers and javascript: URLs are removed.
 */
export function renderMarkdown(source: string, resolve?: WikiResolver | null): string {
  const withLinks = applyWikiLinks(source, resolve ?? null);
  const collector = startFootnoteCollection();
  let raw: string;
  try {
    raw = marked.parse(withLinks, { async: false }) as string;
  } finally {
    stopFootnoteCollection();
  }
  const footnotes = renderFootnotes(collector, (text) =>
    marked.parseInline(text, { async: false }) as string,
  );
  return DOMPurify.sanitize(raw + footnotes, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'data-noto-path'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'formaction'],
  });
}

/** True for links that leave the app (absolute or protocol relative). */
function isExternalHref(href: string): boolean {
  if (href.startsWith('#')) return false;
  if (href.startsWith('//')) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

/** Adds rel="noopener noreferrer" to external links of a rendered fragment. */
export function hardenLinks(html: string): string {
  if (typeof document === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return html;
  root.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (isExternalHref(href)) {
      anchor.setAttribute('rel', 'noopener noreferrer');
      anchor.setAttribute('target', '_blank');
    }
  });
  return root.innerHTML;
}

export function renderSafeMarkdown(source: string, resolve?: WikiResolver | null): string {
  return hardenLinks(renderMarkdown(source, resolve));
}
