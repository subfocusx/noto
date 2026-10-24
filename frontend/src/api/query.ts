// The query API: the selection of the notes by a query of the query language.
//
// The query is executed by the server in the open mode and by the browser in
// the sealed mode, but the answer looks the same in both cases.
import type { SearchHit, TagCount } from '../types';
import { request } from './http';

/** The answer of a query. */
export interface QueryResult {
  /** The notes that match the query. */
  hits: SearchHit[];
  /** The total number of the matching notes (before the limit). */
  total: number;
  /**
   * True when the properties of some notes could not be recalculated, so the
   * answer may be incomplete.
   */
  partial: boolean;
}

/**
 * Runs a query.
 *
 * An empty query matches nothing and does not hit the server at all.
 */
export async function runQuery(
  query: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<QueryResult> {
  const trimmed = query.trim();
  if (!trimmed) return { hits: [], total: 0, partial: false };
  const res = await request<QueryResult>('/query', {
    method: 'POST',
    body: JSON.stringify({ query: trimmed, limit }),
    headers: { 'Content-Type': 'application/json' },
    ...(signal ? { signal } : {}),
  });
  return {
    hits: res.hits ?? [],
    total: res.total ?? 0,
    partial: res.partial ?? false,
  };
}

/** Returns the tags of the vault with the number of the notes that carry them. */
export async function getTags(signal?: AbortSignal): Promise<TagCount[]> {
  const res = await request<{ tags: TagCount[] }>('/tags', signal ? { signal } : {});
  return res.tags ?? [];
}
