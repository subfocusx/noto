import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { appStore } from '../core/store/appStore';
import { VaultSwitchMenu } from '../components/VaultSwitchMenu';

// The tree and the storage of the notes come from the server, so the client of
// the API is the only seam of this test.
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status = 400) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
    }
  },
  getTree: vi.fn(async () => ({ folders: [], files: [] })),
  getNote: vi.fn(async (path: string) => ({
    path,
    content: '',
    revision: 1,
    updatedAt: '',
    conflict: false,
  })),
  saveNote: vi.fn(async (path: string) => ({ path, revision: 2, updatedAt: '' })),
  createFolder: vi.fn(async () => ({})),
  createFile: vi.fn(async () => ({})),
  renameNote: vi.fn(async () => ({})),
  moveNote: vi.fn(async () => ({})),
  deleteNote: vi.fn(async () => ({ ok: true })),
  duplicateNote: vi.fn(async () => ({})),
  search: vi.fn(async () => []),
  listAttachments: vi.fn(async () => []),
  getTrash: vi.fn(async () => ({ entries: [] })),
  restoreNote: vi.fn(async () => ({})),
  importFiles: vi.fn(async () => ({ imported: [], skipped: [], errors: [] })),
  importZip: vi.fn(async () => ({ imported: [], skipped: [], errors: [] })),
  uploadAttachment: vi.fn(async () => ({})),
  deleteAttachment: vi.fn(async () => ({ ok: true })),
  exportNoteUrl: (path: string) => `/api/export/note?path=${path}`,
  exportFolderUrl: (path: string) => `/api/export/folder?path=${path}`,
  exportAllUrl: () => '/api/export/all',
  attachmentRawUrl: (id: string) => `/api/attachments/${id}/raw`,
  getVault: vi.fn(async () => ({
    configured: true,
    path: 'C:\\notes',
    notesDir: 'C:\\notes',
    fixed: false,
  })),
  setVault: vi.fn(async (path: string) => ({ ok: true, path })),
  browseVault: vi.fn(async () => ({ path: 'C:\\', parent: '', dirs: [] })),
}));

vi.mock('../core/vault/session', () => ({
  detectVaultMode: vi.fn(async () => 'open'),
  getSealedVault: vi.fn(() => null),
  lockVault: vi.fn(async () => undefined),
  subscribeVaultSession: vi.fn(() => () => undefined),
}));

describe('the menu of the storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    appStore.reset();
  });

  afterEach(() => {
    appStore.reset();
    localStorage.clear();
  });

  it('offers the storages that are open at the same time', async () => {
    await appStore.actions.chooseVault('C:\\notes');
    await appStore.actions.chooseVault('C:\\beta');

    render(
      <VaultSwitchMenu
        currentPath="C:\\beta"
        recents={['C:\\beta', 'C:\\notes']}
        onSwitch={() => undefined}
        onBrowse={() => undefined}
        onClose={() => undefined}
      />,
    );

    // The storage that is open now stands alone, the other one is in the list
    // of the open storages.
    expect(screen.getByText('Open')).toBeTruthy();
    const item = screen.getByTitle('C:\\notes');
    expect(item.textContent).toContain('C:\\notes');
  });

  it('closes a storage and forgets its state', async () => {
    await appStore.actions.chooseVault('C:\\notes');
    await appStore.actions.chooseVault('C:\\beta');

    render(
      <VaultSwitchMenu
        currentPath="C:\\beta"
        recents={['C:\\beta', 'C:\\notes']}
        onSwitch={() => undefined}
        onBrowse={() => undefined}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Close the storage notes' }));

    expect(appStore.getSnapshot().ui.openStorages).toEqual(['C:\\beta']);
  });
});
