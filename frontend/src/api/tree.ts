// The folder/file tree.
import type { Node, NodePage, TreeResponse } from '../types';
import { jsonInit, request } from './http';

export function getTree(): Promise<TreeResponse> {
  return request<TreeResponse>('/tree');
}

/**
 * One page of the children of a folder.
 *
 * The tree of the interface is loaded lazily: the caller asks for one page at
 * a time and follows the cursor of the answer. The cursor of the answer is
 * empty when the page is the last one.
 */
export function getTreePage(
  parentPath: string,
  cursor?: string,
  limit?: number,
): Promise<NodePage> {
  const query = new URLSearchParams();
  query.set('parent', parentPath);
  if (cursor) query.set('cursor', cursor);
  if (limit !== undefined) query.set('limit', String(limit));
  return request<NodePage>(`/tree/children?${query.toString()}`);
}

export function createFolder(parentPath: string, name: string): Promise<Node> {
  return request<Node>('/folders', jsonInit('POST', { parentPath, name }));
}

export function createFile(parentPath: string, name: string): Promise<Node> {
  return request<Node>('/files', jsonInit('POST', { parentPath, name }));
}
