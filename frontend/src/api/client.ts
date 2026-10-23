// Single typed HTTP client for the Noto REST API (docs/CONTRACT.md §3).
import type {
  Attachment,
  ConflictPolicy,
  HealthResponse,
  ImportResult,
  Node,
  NoteContent,
  SaveNoteResponse,
  SearchHit,
  TrashResponse,
  TreeResponse,
} from '../types';

export const API_BASE = '/api';

/** Error thrown for every non-2xx API response. Carries the server code. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly current?: NoteContent;

  constructor(code: string, message: string, status: number, current?: NoteContent) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (current) this.current = current;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; current?: NoteContent };
}

/** Fallback code when the response body carries no machine readable code. */
function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    default:
      return 'internal';
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let code = codeForStatus(res.status);
  let message = `request failed with status ${res.status}`;
  let current: NoteContent | undefined;
  try {
    const body = (await res.json()) as ErrorEnvelope;
    if (body && body.error) {
      if (body.error.code) code = body.error.code;
      if (body.error.message) message = body.error.message;
      if (body.error.current) current = body.error.current;
    }
  } catch {
    /* non JSON error body — keep the default message */
  }
  return new ApiError(code, message, res.status, current);
}

/**
 * The one and only place where HTTP happens.
 * Resolves with the parsed JSON body, or throws {@link ApiError}.
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (err) {
    if (isAbortError(err)) {
      throw new ApiError('aborted', 'request aborted', 0);
    }
    throw new ApiError(
      'network_error',
      'Cannot reach the Noto server. Check that it is running and reachable.',
      0,
    );
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('internal', 'malformed response body', res.status);
  }
}

/** True for the DOMException / Error thrown by `AbortController.abort()`. */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return name === 'AbortError';
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/* ------------------------------------------------------------------ health */

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

/* -------------------------------------------------------------------- tree */

export function getTree(): Promise<TreeResponse> {
  return request<TreeResponse>('/tree');
}

export function createFolder(parentPath: string, name: string): Promise<Node> {
  return request<Node>('/folders', jsonInit('POST', { parentPath, name }));
}

export function createFile(parentPath: string, name: string): Promise<Node> {
  return request<Node>('/files', jsonInit('POST', { parentPath, name }));
}

/* ------------------------------------------------------------------- notes */

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

export function restoreNote(trashPath: string): Promise<Node> {
  return request<Node>('/notes/restore', jsonInit('POST', { trashPath }));
}

export function getTrash(): Promise<TrashResponse> {
  return request<TrashResponse>('/trash');
}

/* ------------------------------------------------------------------ search */

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

/* ----------------------------------------------------------- import/export */

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

/* ------------------------------------------------------------- attachments */

export async function listAttachments(): Promise<Attachment[]> {
  const res = await request<{ attachments: Attachment[] }>('/attachments');
  return res.attachments ?? [];
}

export function uploadAttachment(file: File, notePath: string): Promise<Attachment> {
  const form = new FormData();
  form.append('file', file, file.name);
  if (notePath) form.append('notePath', notePath);
  return request<Attachment>('/attachments', { method: 'POST', body: form });
}

export function deleteAttachment(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function attachmentRawUrl(id: string): string {
  return `${API_BASE}/attachments/${encodeURIComponent(id)}/raw`;
}
