// The names of the tags.
//
// A tag is a word in the text of a note, written as `#word`. The name of the
// tag is normalised the same way everywhere: the name is compared with the
// names of the other tags, so `#Work` and `#work` must be one tag.

/**
 * Normalises a tag: lower case, without the `#`, with the characters the
 * language of the tags allows.
 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
