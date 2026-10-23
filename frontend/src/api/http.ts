// The one and only place where HTTP happens (docs/CONTRACT.md §3).
// Every other module of `src/api/**` builds on top of {@link request}.
import type { NoteContent } from '../types';

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
export function codeForStatus(status: number): string {
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

export async function parseError(res: Response): Promise<ApiError> {
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

/** Request init with a JSON encoded body. */
export function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
