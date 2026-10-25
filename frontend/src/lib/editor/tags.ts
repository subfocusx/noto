// The completion of the tags inside the editor.
//
// The tags of a vault are written in the text of a note as `#word`. While the
// user types the `#`, the editor offers the tags that already exist. The
// rules of the token and of the list live here, so they can be tested without
// an editor.

/** A `#tag` token under the caret. */
export interface TagToken {
  /** The position of the `#`. */
  from: number;
  /** The position right after the typed part of the tag. */
  to: number;
  /** The typed part of the tag, without the `#`. */
  text: string;
}

/** The maximum number of the offered tags. */
export const TAG_SUGGESTION_LIMIT = 8;

/** The characters a tag may hold. */
const TAG_CHARS = /[A-Za-z0-9_/-]/;

/** The characters that may stand before a `#`. */
const BEFORE_HASH = /[\s([{>,;:]/;

/**
 * The `#tag` token at the caret, if the caret is inside one.
 *
 * The `#` must start a word: the `#` of `a#b` is a part of a word, not a
 * tag. The caret may be inside the tag or right behind its `#`: the list of
 * the suggestions is shown in both cases.
 *
 * @returns the token, or `null` when the caret is not inside a tag.
 */
export function parseTagToken(text: string, caret: number): TagToken | null {
  const position = Math.max(0, Math.min(caret, text.length));
  let index = position;
  while (index > 0 && TAG_CHARS.test(text[index - 1] as string)) index -= 1;
  if (index === 0 || text[index - 1] !== '#') return null;
  const hash = index - 1;
  const before = hash > 0 ? text[hash - 1] : undefined;
  if (before !== undefined && !BEFORE_HASH.test(before)) return null;
  return { from: hash, to: position, text: text.slice(hash + 1, position) };
}

/**
 * The tags of the vault that match the typed part.
 *
 * The tags that start with the typed part come first, then the tags that
 * only contain it. The order inside a group is the alphabetical one, so the
 * list is stable.
 */
export function filterTagSuggestions(
  tags: string[],
  token: string,
  limit: number = TAG_SUGGESTION_LIMIT,
): string[] {
  const needle = token.trim().toLowerCase();
  const starts: string[] = [];
  const contains: string[] = [];
  for (const tag of tags) {
    const name = tag.replace(/^#/, '');
    if (name === '') continue;
    const lower = name.toLowerCase();
    if (needle === '' || lower.startsWith(needle)) starts.push(name);
    else if (lower.includes(needle)) contains.push(name);
  }
  const byName = (a: string, b: string): number => a.localeCompare(b);
  starts.sort(byName);
  contains.sort(byName);
  return [...starts, ...contains].slice(0, Math.max(0, limit));
}

/**
 * The text with the tag of the suggestion, and the caret after it.
 *
 * The typed part of the token is replaced by the chosen tag. A space follows
 * the tag, so the user can keep writing without leaving the tag.
 */
export function applyTagSuggestion(
  text: string,
  token: TagToken,
  tag: string,
): { text: string; caret: number } {
  const name = tag.replace(/^#/, '');
  const before = text.slice(0, token.from);
  const after = text.slice(token.to);
  const inserted = `#${name} `;
  return { text: `${before}${inserted}${after}`, caret: token.from + inserted.length };
}
