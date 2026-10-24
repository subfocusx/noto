// The in-memory full text index of the sealed vault.
//
// The index holds decrypted note content, so it lives in the memory of the
// tab only: it is never written to the disk and never sent to the backend.
// It is rebuilt from the sealed content right after the vault is unlocked.

import type { SearchHit } from '../../types';

/** The note that is added to the index. */
export interface IndexSource {
  path: string;
  name: string;
  content: string;
}

/**
 * The inverted index of the vault.
 *
 * `tokens` maps a normalised token onto the set of the paths that contain
 * it, `excerpts` keeps a short plaintext excerpt per path so that a search
 * can show a snippet without decrypting every note again.
 */
export interface SearchIndex {
  tokens: Map<string, Set<string>>;
  excerpts: Map<string, string>;
  names: Map<string, string>;
}

/** The maximum length of the plaintext excerpt kept per note. */
const EXCERPT_LIMIT = 600;

/** The size of the window shown as a search snippet. */
const SNIPPET_WINDOW = 90;

/**
 * Splits a text into normalised tokens.
 *
 * The split happens on every non letter / non digit character, so that
 * punctuation, markdown marks and paths do not create noise tokens.
 */
export function tokenize(text: string): string[] {
  const matched = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return matched ?? [];
}

/** Creates an empty index. */
export function createIndex(): SearchIndex {
  return {
    tokens: new Map(),
    excerpts: new Map(),
    names: new Map(),
  };
}

/**
 * Builds the index from a list of decrypted notes.
 *
 * The index is a pure function of the content: building it twice over the
 * same notes gives the same result.
 */
export function buildIndex(entries: IndexSource[]): SearchIndex {
  const index = createIndex();
  for (const entry of entries) {
    updateIndex(index, entry.path, entry.content, entry.name);
  }
  return index;
}

/** Drops every token that points at the given path. */
export function removeIndex(index: SearchIndex, path: string): void {
  for (const paths of index.tokens.values()) paths.delete(path);
  index.excerpts.delete(path);
  index.names.delete(path);
}

/**
 * Adds or replaces the content of one note in the index.
 *
 * The old tokens of the path are removed first, so that a rewritten note
 * never leaves stale tokens behind.
 */
export function updateIndex(
  index: SearchIndex,
  path: string,
  content: string,
  name?: string,
): void {
  removeIndex(index, path);
  index.excerpts.set(path, content.slice(0, EXCERPT_LIMIT));
  if (name !== undefined) index.names.set(path, name);
  for (const token of tokenize(content)) {
    let paths = index.tokens.get(token);
    if (!paths) {
      paths = new Set<string>();
      index.tokens.set(token, paths);
    }
    paths.add(path);
  }
}

/**
 * Builds the snippet shown next to a search hit.
 *
 * The window is centred on the first occurrence of the token, so the user
 * sees the matched sentence instead of the beginning of the note.
 */
function snippetFor(excerpt: string, token: string): string {
  const at = excerpt.toLowerCase().indexOf(token);
  if (at < 0) return excerpt.slice(0, SNIPPET_WINDOW).trim();
  const start = Math.max(0, at - Math.floor(SNIPPET_WINDOW / 3));
  const end = Math.min(excerpt.length, start + SNIPPET_WINDOW);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < excerpt.length ? '…' : '';
  return `${prefix}${excerpt.slice(start, end).trim()}${suffix}`;
}

/**
 * Searches the index.
 *
 * Every token of the query must be present in a note (an AND search), so a
 * longer query is always more selective than its parts.
 */
export function searchIndex(index: SearchIndex, query: string, limit = 20): SearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  let candidates: Set<string> | null = null;
  for (const token of tokens) {
    const paths = index.tokens.get(token);
    if (!paths || paths.size === 0) return [];
    candidates = candidates === null ? new Set(paths) : intersect(candidates, paths);
    if (candidates.size === 0) return [];
  }
  if (!candidates) return [];

  const hits: SearchHit[] = [];
  for (const path of candidates) {
    const excerpt = index.excerpts.get(path) ?? '';
    hits.push({
      path,
      name: index.names.get(path) ?? path,
      kind: 'content',
      snippet: snippetFor(excerpt, tokens[0]),
    });
    if (hits.length >= limit) break;
  }
  hits.sort((a, b) => a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

/** Returns the intersection of two sets of paths. */
function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const value of a) {
    if (b.has(value)) out.add(value);
  }
  return out;
}
