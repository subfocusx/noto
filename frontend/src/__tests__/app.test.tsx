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
  getVault: vi.fn(async () => ({ configured: true, path: 'C:\\notes', notesDir: 'C:\\notes' })),
  setVault: vi.fn(async () => ({ ok: true, path: 'C:\\notes' })),
  browseVault: vi.fn(async () => ({ path: 'C:\\', parent: '', dirs: [] })),
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

  it('opens a note in the editor', async () => {
    const view = render(<App />);
    await waitFor(() => expect(view.getByText('journal')).toBeTruthy());
    fireEvent.click(view.getByLabelText('Expand journal'));
    fireEvent.click(view.getByText('a.md'));
    await waitFor(() => expect(view.getByTestId('markdown-editor')).toBeTruthy());
    expect(view.queryByTestId('empty-state')).toBeNull();
  });

  it('has no view mode control', async () => {
    const view = render(<App />);
    expect(view.queryByLabelText('View mode')).toBeNull();
    expect(view.queryByText('View mode')).toBeNull();
  });
});
