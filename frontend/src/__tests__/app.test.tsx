import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/preact';
import { App } from '../App';
import { setVault } from '../api/client';
import { appStore } from '../core/store/appStore';

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
  // The store is a singleton: every test starts from a clean state.
  appStore.reset();
});

/** Opens the folder of the tree and the note that is inside it. */
async function openNoteInTheTree(view: ReturnType<typeof render>): Promise<void> {
  const expand = view.queryByLabelText('Expand journal');
  if (expand) fireEvent.click(expand);
  fireEvent.click(within(view.getByTestId('file-tree')).getByText('a.md'));
  await waitFor(() => expect(view.getByTestId('markdown-editor')).toBeTruthy());
}

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
    fireEvent.click(within(view.getByTestId('file-tree')).getByText('a.md'));
    await waitFor(() => expect(view.getByTestId('markdown-editor')).toBeTruthy());
    expect(view.queryByTestId('empty-state')).toBeNull();
  });

  it('has one control of the mode: the pencil of the strip of the tabs', async () => {
    const view = render(<App />);
    await waitFor(() => expect(view.getByTestId('file-tree')).toBeTruthy());
    await openNoteInTheTree(view);

    // One button, two modes: there is no separate selector of the mode.
    expect(view.getByTestId('tab-mode')).toBeTruthy();
    expect(view.queryByLabelText('View mode')).toBeNull();
    expect(view.queryByText('View mode')).toBeNull();
  });

  it('switches the note between the editing and the reading with that pencil', async () => {
    const view = render(<App />);
    await waitFor(() => expect(view.getByTestId('file-tree')).toBeTruthy());
    await openNoteInTheTree(view);

    // The note is edited: the pencil is pressed.
    const pencil = view.getByTestId('tab-mode');
    expect(pencil.getAttribute('aria-pressed')).toBe('true');

    // One click: the editor gives its place to the reading of the note.
    // The renderer of the Markdown lives in its own chunk: it takes a moment.
    fireEvent.click(pencil);
    await waitFor(() => expect(view.getByTestId('preview')).toBeTruthy(), { timeout: 5000 });
    expect(view.queryByTestId('markdown-editor')).toBeNull();
    expect(view.getByTestId('tab-mode').getAttribute('aria-pressed')).toBe('false');

    // The same pencil brings the editor back.
    fireEvent.click(view.getByTestId('tab-mode'));
    await waitFor(() => expect(view.getByTestId('markdown-editor')).toBeTruthy());
    expect(view.queryByTestId('preview')).toBeNull();
  });

  it('keeps the dialog of the storage open when the switch fails', async () => {
    // The store shows the reason in a banner and rethrows: the interface must
    // not let the refusal become an unhandled rejection.
    vi.mocked(setVault).mockRejectedValueOnce(new Error('the folder cannot be used'));
    const view = render(<App />);
    await waitFor(() => expect(view.getByTestId('file-tree')).toBeTruthy());

    fireEvent.click(view.getByRole('button', { name: /change the storage of the notes/i }));
    fireEvent.click(view.getByRole('menuitem', { name: /Choose another folder/ }));
    // The picker lives in a lazy chunk: the import must have the time.
    await waitFor(() => expect(view.getByTestId('vault-picker')).toBeTruthy(), { timeout: 5000 });

    fireEvent.click(view.getByTestId('vault-picker-confirm'));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toContain('the folder cannot be used'),
    );
    // The dialog stays open: the user may choose another folder.
    expect(view.getByTestId('vault-picker')).toBeTruthy();
  });
});
