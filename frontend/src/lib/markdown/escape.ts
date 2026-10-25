// The escaping of the text that goes into the HTML.
//
// The escape lives in its own module, so the parts of the renderer (the
// formulas, the footnotes, the code blocks) can use it without a cycle of
// imports.

/** Escapes the characters that have a meaning in the HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
