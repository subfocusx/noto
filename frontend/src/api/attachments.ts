// Attachments: upload, list, delete and raw download URLs.
import type { Attachment } from '../types';
import { API_BASE, request } from './http';

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
