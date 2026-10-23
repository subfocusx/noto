// Markdown preview rendering: marked -> DOMPurify -> safe HTML.
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { WIKI_LINK_RE, type WikiResolver } from './wiki';

marked.setOptions({ gfm: true, breaks: true });

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  const raw = marked.parse(withLinks, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
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
