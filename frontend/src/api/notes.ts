// Note documents: read, write, rename, move and delete.
import type { Node, NoteContent, SaveNoteResponse } from '../types';
import { jsonInit, request } from './http';

export function getNote(path: string): Promise<NoteContent> {
  return request<NoteContent>(`/notes?path=${encodeURIComponent(path)}`);
}

export function saveNote(path: string, content: string, revision: number): Promise<SaveNoteResponse> {
  return request<SaveNoteResponse>('/notes', jsonInit('PUT', { path, content, revision }));
}

export function renameNote(path: string, newName: string): Promise<Node> {
  return request<Node>('/notes/rename', jsonInit('POST', { path, newName }));
}

export function moveNote(path: string, newParentPath: string): Promise<Node> {
  return request<Node>('/notes/move', jsonInit('POST', { path, newParentPath }));
}

export function deleteNote(path: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/notes?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}
