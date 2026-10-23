// The trash: list deleted notes and restore them.
import type { Node, TrashResponse } from '../types';
import { jsonInit, request } from './http';

export function getTrash(): Promise<TrashResponse> {
  return request<TrashResponse>('/trash');
}

export function restoreNote(trashPath: string): Promise<Node> {
  return request<Node>('/notes/restore', jsonInit('POST', { trashPath }));
}
