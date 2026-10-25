// The typed API of the attachments: the search inside the files, the preview
// and the bytes of a file.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request, requestBlob } from '../api/http';
import {
  attachmentContentUrl,
  getAttachmentContent,
  getAttachmentPreview,
  searchAttachments,
} from '../api/attachments';

vi.mock('../api/http', () => ({
  API_BASE: '/api',
  request: vi.fn(),
  requestBlob: vi.fn(),
}));

const mockedRequest = vi.mocked(request);
const mockedRequestBlob = vi.mocked(requestBlob);

beforeEach(() => {
  mockedRequest.mockReset();
  mockedRequestBlob.mockReset();
});

describe('the API of the attachments', () => {
  it('searches the text inside the files with a POST', async () => {
    mockedRequest.mockResolvedValue({
      hits: [
        {
          noteId: 'note-1',
          attachmentId: 'att-1',
          name: 'report.txt',
          mime: 'text/plain',
          snippet: 'the total is 42',
        },
      ],
    });

    const hits = await searchAttachments('42');

    expect(hits).toHaveLength(1);
    expect(hits[0]?.attachmentId).toBe('att-1');
    expect(hits[0]?.snippet).toBe('the total is 42');
    const [path, init] = mockedRequest.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/attachments/search');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ query: '42', limit: 50 });
  });

  it('does not hit the server for an empty query', async () => {
    expect(await searchAttachments('   ')).toEqual([]);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('builds the URL of the bytes of a file', () => {
    expect(attachmentContentUrl('att 1')).toBe('/api/attachments/att%201/content');
  });

  it('asks the server for the preview of a file', async () => {
    mockedRequest.mockResolvedValue({
      mime: 'image/png',
      width: 800,
      height: 600,
      url: '/api/attachments/att-1/content',
    });

    const preview = await getAttachmentPreview('att-1');

    expect(preview.width).toBe(800);
    expect(preview.height).toBe(600);
    expect(mockedRequest.mock.calls[0]?.[0]).toBe('/attachments/att-1/preview');
    expect(mockedRequest.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('reads the bytes of a file as a blob', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    mockedRequestBlob.mockResolvedValue(blob);

    expect(await getAttachmentContent('att-1')).toBe(blob);
    expect(mockedRequestBlob).toHaveBeenCalledWith('/attachments/att-1/content');
  });
});
