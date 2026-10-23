// The folder/file tree.
import type { Node, TreeResponse } from '../types';
import { jsonInit, request } from './http';

export function getTree(): Promise<TreeResponse> {
  return request<TreeResponse>('/tree');
}

export function createFolder(parentPath: string, name: string): Promise<Node> {
  return request<Node>('/folders', jsonInit('POST', { parentPath, name }));
}

export function createFile(parentPath: string, name: string): Promise<Node> {
  return request<Node>('/files', jsonInit('POST', { parentPath, name }));
}
