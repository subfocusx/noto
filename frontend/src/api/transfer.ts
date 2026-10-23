// Import and export of notes and folders.
import type { ConflictPolicy, ImportResult } from '../types';
import { API_BASE, request } from './http';

export async function importFiles(
  files: File[],
  targetPath: string,
  conflict: ConflictPolicy,
): Promise<ImportResult> {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  form.append('targetPath', targetPath);
  form.append('conflict', conflict);
  return request<ImportResult>('/import/files', { method: 'POST', body: form });
}

export function importZip(
  file: File,
  targetPath: string,
  conflict: ConflictPolicy,
): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('targetPath', targetPath);
  form.append('conflict', conflict);
  return request<ImportResult>('/import/zip', { method: 'POST', body: form });
}

export function exportNoteUrl(path: string): string {
  return `${API_BASE}/export/note?path=${encodeURIComponent(path)}`;
}

export function exportFolderUrl(path: string): string {
  return `${API_BASE}/export/folder?path=${encodeURIComponent(path)}`;
}

export function exportAllUrl(): string {
  return `${API_BASE}/export/all`;
}
