import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createFolder,
  deleteNote,
  getNote,
  getTree,
  request,
  saveNote,
  search,
} from '../api/client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api client', () => {
  it('returns the parsed body for a successful request', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ folders: [], files: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const tree = await getTree();
    expect(tree).toEqual({ folders: [], files: [] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tree');
  });

  it('throws ApiError with the server code and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { code: 'duplicate_name', message: 'name exists' } }, 409)),
    );
    await expect(createFolder('', 'a')).rejects.toBeInstanceOf(ApiError);
    try {
      await createFolder('', 'a');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('duplicate_name');
      expect((err as ApiError).message).toBe('name exists');
      expect((err as ApiError).status).toBe(409);
    }
  });

  it('exposes the server state on a revision conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: 'revision_conflict',
              message: 'stale revision',
              current: { path: 'a.md', content: 'server', revision: 7, updatedAt: '', conflict: true },
            },
          },
          409,
        ),
      ),
    );
    try {
      await saveNote('a.md', 'client', 3);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('revision_conflict');
      expect(apiErr.current?.revision).toBe(7);
    }
  });

  it('falls back to a generic error for non JSON bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>boom</html>', { status: 500 })),
    );
    try {
      await request('/tree');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('internal');
      expect((err as ApiError).status).toBe(500);
    }
  });

  it('reports network failures as a network_error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    try {
      await getNote('a.md');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('network_error');
    }
  });

  it('sends the revision with a save', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ path: 'a.md', revision: 4, updatedAt: '' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await saveNote('a.md', 'body', 3);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('/api/notes');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ path: 'a.md', content: 'body', revision: 3 });
  });

  it('encodes the path of a note request and delete', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteNote('journal/a b.md');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/notes?path=journal%2Fa%20b.md');
  });

  it('returns hits from search', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ hits: [{ path: 'a.md', name: 'a.md', kind: 'name', snippet: '' }] })),
    );
    const hits = await search('a');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('a.md');
  });

  it('does not send a request for an empty search query', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ hits: [] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await search('')).toEqual([]);
    expect(await search('   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an aborted request with the aborted code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        throw err;
      }),
    );
    try {
      await getNote('a.md');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('aborted');
    }
  });

  it('explains a network failure in a readable way', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    try {
      await getNote('a.md');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('network_error');
      expect((err as ApiError).message).toMatch(/Noto server/);
    }
  });

  it('derives the error code from the status when the body has no envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    try {
      await request('/notes?path=a.md');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('not_found');
      expect((err as ApiError).status).toBe(404);
    }
  });
});
