// The panel of the attachments: the preview of the pictures, the lightbox and
// the search inside the text of the files.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { getAttachmentPreview, listAttachments, searchAttachments } from '../api/client';
import { AttachmentsPanel } from '../components/AttachmentsPanel';
import type { Attachment } from '../types';

vi.mock('../api/client', () => ({
  attachmentContentUrl: (id: string) => `/api/attachments/${id}/content`,
  attachmentRawUrl: (id: string) => `/api/attachments/${id}/raw`,
  deleteAttachment: vi.fn(async () => ({ ok: true })),
  getAttachmentPreview: vi.fn(async () => ({
    mime: 'image/png',
    width: 800,
    height: 600,
    url: '/api/attachments/att-1/content',
  })),
  listAttachments: vi.fn(async () => []),
  searchAttachments: vi.fn(async () => []),
  uploadAttachment: vi.fn(async () => ({
    id: 'att-new',
    name: 'new.png',
    mime: 'image/png',
    size: 10,
    createdAt: '2026-10-25T12:00:00Z',
  })),
}));

const mockedList = vi.mocked(listAttachments);
const mockedSearch = vi.mocked(searchAttachments);
const mockedPreview = vi.mocked(getAttachmentPreview);

function attachment(over: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att-1',
    name: 'picture.png',
    mime: 'image/png',
    size: 1024,
    createdAt: '2026-10-25T12:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedList.mockResolvedValue([]);
  mockedSearch.mockResolvedValue([]);
});

describe('the panel of the attachments', () => {
  it('shows a thumbnail for a picture and the metadata of the file', async () => {
    mockedList.mockResolvedValue([attachment()]);
    render(<AttachmentsPanel notePath="a.md" onInsert={() => undefined} />);

    const thumb = await screen.findByLabelText('Preview picture.png');
    expect(thumb.querySelector('img')?.getAttribute('src')).toBe('/api/attachments/att-1/content');

    const row = screen.getByTestId('attachment-list');
    expect(row.textContent).toContain('image/png');
    expect(row.textContent).toContain('1.0 KB');
    expect(row.textContent).toContain('2026-10-25');
  });

  it('shows an icon and no thumbnail for a file that is not a picture', async () => {
    mockedList.mockResolvedValue([
      attachment({ id: 'att-2', name: 'notes.txt', mime: 'text/plain', size: 10 }),
    ]);
    const { container } = render(<AttachmentsPanel notePath="a.md" onInsert={() => undefined} />);

    await screen.findByText('notes.txt');
    expect(screen.queryByLabelText('Preview notes.txt')).toBeNull();
    expect(container.querySelectorAll('.attachment-icon')).toHaveLength(1);
    expect(container.querySelector('.attachment-icon')?.querySelector('svg')).toBeTruthy();
  });

  it('opens the lightbox on the thumbnail and closes it with Escape', async () => {
    mockedList.mockResolvedValue([attachment()]);
    render(<AttachmentsPanel notePath="a.md" onInsert={() => undefined} />);

    fireEvent.click(await screen.findByLabelText('Preview picture.png'));

    const image = await screen.findByTestId('attachment-lightbox-image');
    expect(image.getAttribute('src')).toBe('/api/attachments/att-1/content');
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('attachment-lightbox-image')).toBeNull());
  });

  it('moves from one picture to the other with the arrows', async () => {
    mockedList.mockResolvedValue([
      attachment({ id: 'att-1', name: 'one.png' }),
      attachment({ id: 'att-2', name: 'two.png' }),
    ]);
    render(<AttachmentsPanel notePath="a.md" onInsert={() => undefined} />);

    fireEvent.click(await screen.findByLabelText('Preview one.png'));
    await screen.findByTestId('attachment-lightbox-image');

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(screen.getByTestId('attachment-lightbox-image').getAttribute('src')).toBe(
        '/api/attachments/att-2/content',
      ),
    );

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    await waitFor(() =>
      expect(screen.getByTestId('attachment-lightbox-image').getAttribute('src')).toBe(
        '/api/attachments/att-1/content',
      ),
    );
  });

  it('asks the server for the size of the picture of the lightbox', async () => {
    mockedList.mockResolvedValue([attachment()]);
    render(<AttachmentsPanel notePath="a.md" onInsert={() => undefined} />);

    fireEvent.click(await screen.findByLabelText('Preview picture.png'));

    await waitFor(() => expect(screen.getByText('800 × 600 px')).toBeTruthy());
    expect(mockedPreview).toHaveBeenCalledWith('att-1');
  });

  it('searches the text inside the files and shows the snippet', async () => {
    mockedSearch.mockResolvedValue([
      {
        noteId: 'note-1',
        notePath: 'journal/a.md',
        attachmentId: 'att-1',
        name: 'report.txt',
        mime: 'text/plain',
        snippet: 'the total is 42',
      },
    ]);
    render(<AttachmentsPanel notePath="a.md" onInsert={() => undefined} />);

    fireEvent.input(screen.getByLabelText('Search in files'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search files' }));

    const results = await screen.findByTestId('attachment-search-results');
    expect(results.textContent).toContain('report.txt');
    expect(results.textContent).toContain('the total is 42');
    expect(results.textContent).toContain('journal/a.md');
    expect(mockedSearch).toHaveBeenCalledWith('42');
  });

  it('does not search for an empty query', async () => {
    render(<AttachmentsPanel notePath="a.md" onInsert={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Search files' }));

    expect(mockedSearch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('attachment-search-results')).toBeNull();
  });

  it('shows the list by pages when there are many files', async () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      attachment({ id: `att-${index}`, name: `file-${index}.png` }),
    );
    mockedList.mockResolvedValue(many);
    const { container } = render(<AttachmentsPanel notePath="a.md" onInsert={() => undefined} />);

    await screen.findByText('file-0.png');
    expect(container.querySelectorAll('.attachment-list li')).toHaveLength(50);

    fireEvent.click(screen.getByRole('button', { name: /Show more/ }));

    await waitFor(() => expect(container.querySelectorAll('.attachment-list li')).toHaveLength(60));
  });
});
