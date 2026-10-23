import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/preact';
import { App } from '../App';

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  getTree: async () => ({
    folders: [
      {
        id: 'journal',
        name: 'journal',
        path: 'journal',
        type: 'folder',
        parentPath: '',
        size: 0,
        modTime: '',
        revision: 1,
        createdAt: '',
        updatedAt: '',
      },
    ],
    files: [
      {
        id: 'journal/a.md',
        name: 'a.md',
        path: 'journal/a.md',
        type: 'file',
        parentPath: 'journal',
        size: 3,
        modTime: '',
        revision: 1,
        createdAt: '',
        updatedAt: '',
      },
    ],
  }),
  getNote: async (path: string) => ({
    path,
    content: '# hello',
    revision: 1,
    updatedAt: new Date(0).toISOString(),
    conflict: false,
  }),
  saveNote: async (path: string) => ({ path, revision: 2, updatedAt: '' }),
  createFolder: async () => ({}),
  createFile: async () => ({}),
  renameNote: async () => ({}),
  moveNote: async () => ({}),
  deleteNote: async () => ({ ok: true }),
  search: async () => [],
  listAttachments: async () => [],
  getTrash: async () => ({ entries: [] }),
  restoreNote: async () => ({}),
  importFiles: async () => ({ imported: [], skipped: [], errors: [] }),
  importZip: async () => ({ imported: [], skipped: [], errors: [] }),
  uploadAttachment: async () => ({}),
  deleteAttachment: async () => ({ ok: true }),
  exportNoteUrl: (path: string) => `/api/export/note?path=${path}`,
  exportFolderUrl: (path: string) => `/api/export/folder?path=${path}`,
  exportAllUrl: () => '/api/export/all',
  attachmentRawUrl: (id: string) => `/api/attachments/${id}/raw`,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('app shell', () => {
  it('renders the tree, the status indicator and the empty state', async () => {
    const view = render(<App />);
    await waitFor(() => expect(view.getByTestId('file-tree')).toBeTruthy());
    expect(view.getByTestId('save-status').textContent).toBe('Idle');
    expect(view.getByTestId('empty-state')).toBeTruthy();
  });

  it('opens a note and shows its preview', async () => {
    const view = render(<App />);
    await waitFor(() => expect(view.getByText('journal')).toBeTruthy());
    fireEvent.click(view.getByLabelText('Expand journal'));
    fireEvent.click(view.getByText('a.md'));
    await waitFor(() => expect(view.getByTestId('preview').innerHTML).toContain('<h1>hello</h1>'));
    expect(view.queryByTestId('empty-state')).toBeNull();
  });

  it('switches the view mode', async () => {
    const view = render(<App />);
    const previewButton = view.getByText('preview');
    fireEvent.click(previewButton);
    expect(view.getByText('preview').getAttribute('aria-pressed')).toBe('true');
  });
});
