// Attachments: upload, list, delete, raw download URLs, preview and search.
import type { Attachment } from '../types';
import { API_BASE, request, requestBlob } from './http';

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

/** A hit of the search inside the text of the attachments. */
export interface AttachmentSearchHit {
  /** The identifier of the note that owns the attachment. */
  noteId: string;
  /** The path of the note that owns the attachment (optional). */
  notePath?: string;
  /** The identifier of the attachment that matched. */
  attachmentId: string;
  /** The name of the attachment. */
  name: string;
  /** The mime type of the attachment. */
  mime: string;
  /** The text around the match. */
  snippet: string;
}

/** The preview of an attachment (the metadata of the image). */
export interface AttachmentPreview {
  /** The mime type of the file. */
  mime: string;
  /** The width of the image, in pixels (0 when it is not an image). */
  width: number;
  /** The height of the image, in pixels (0 when it is not an image). */
  height: number;
  /** The URL of the bytes of the file. */
  url: string;
}

/**
 * Searches the text inside the attachments.
 *
 * An empty query matches nothing and does not hit the server at all.
 */
export async function searchAttachments(
  query: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<AttachmentSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const res = await request<{ hits: AttachmentSearchHit[] }>(
    '/attachments/search',
    {
      method: 'POST',
      body: JSON.stringify({ query: trimmed, limit }),
      headers: { 'Content-Type': 'application/json' },
      ...(signal ? { signal } : {}),
    },
  );
  return res.hits ?? [];
}

/** The URL of the bytes of an attachment. */
export function attachmentContentUrl(id: string): string {
  return `${API_BASE}/attachments/${encodeURIComponent(id)}/content`;
}

/** The metadata of the preview of an attachment. */
export function getAttachmentPreview(id: string): Promise<AttachmentPreview> {
  return request<AttachmentPreview>(`/attachments/${encodeURIComponent(id)}/preview`, {
    method: 'POST',
  });
}

/** The bytes of an attachment. */
export function getAttachmentContent(id: string): Promise<Blob> {
  return requestBlob(`/attachments/${encodeURIComponent(id)}/content`);
}
