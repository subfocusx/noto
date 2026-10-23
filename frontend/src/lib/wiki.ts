// Wiki link resolution: [[Note Name]] -> link to the note with that name.
import type { Node } from '../types';
import { compareStrings } from './utils';

export interface WikiResolver {
  /** Resolve a wiki link target to a note path, or null when unmatched. */
  (target: string): string | null;
}

/**
 * Builds a resolver from the list of note files.
 * The first match by name wins; duplicates are resolved by path order
 * (lexicographically smallest path).
 */
export function createWikiResolver(files: Node[]): WikiResolver {
  const byName = new Map<string, string>();
  const byPath = new Map<string, string>();
  const sorted = [...files].sort((a, b) => compareStrings(a.path, b.path));
  for (const file of sorted) {
    const key = normalizeName(file.name);
    if (!byName.has(key)) byName.set(key, file.path);
    // A wiki link may also point at the name without the .md suffix.
    const bare = normalizeName(stripMd(file.name));
    if (bare && !byName.has(bare)) byName.set(bare, file.path);
    const pathKey = normalizeName(file.path);
    if (!byPath.has(pathKey)) byPath.set(pathKey, file.path);
  }
  return (target: string): string | null => {
    const key = normalizeName(target);
    // A link may address a note by its full path.
    if (key.includes('/')) {
      const byPathHit = byPath.get(key);
      if (byPathHit) return byPathHit;
    }
    return byName.get(key) ?? null;
  };
}

export function stripMd(name: string): string {
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export const WIKI_LINK_RE = /\[\[([^\[\]\n]+)\]\]/g;

/** Returns the wiki link targets contained in a markdown source. */
export function extractWikiTargets(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(WIKI_LINK_RE)) {
    const value = match[1];
    if (value) out.push(value.trim());
  }
  return out;
}
