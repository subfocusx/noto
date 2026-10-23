// Full text search over notes.
import type { SearchHit } from '../types';
import { request } from './http';

export async function search(query: string, limit = 50, signal?: AbortSignal): Promise<SearchHit[]> {
  // An empty query must not hit the server at all.
  if (!query.trim()) return [];
  const res = await request<{ hits: SearchHit[] }>(
    `/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    signal ? { signal } : {},
  );
  return res.hits ?? [];
}

export function reindex(): Promise<{ indexed: number }> {
  return request<{ indexed: number }>('/search/reindex', { method: 'POST' });
}
