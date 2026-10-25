import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { appStore } from '../core/store/appStore';
import { storageRegistry } from '../core/storages/storageRegistry';
import type { Node } from '../types';

// The tree and the storage of the notes come from the server, so the client of
// the API is the only seam of this test. The mock keeps the tree of every
// storage, so the switch really walks from one folder of notes to another.
const server = vi.hoisted(() => ({
  current: '',
  trees: {} as Record<string, { folders: unknown[]; files: unknown[] }>,
}));

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
  getTree: vi.fn(async () => server.trees[server.current] ?? { folders: [], files: [] }),
  getNote: vi.fn(async (path: string) => ({
    path,
    content: `text of ${path}`,
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
    path: server.current,
    notesDir: server.current,
    fixed: false,
  })),
  setVault: vi.fn(async (path: string) => {
    server.current = path;
    return { ok: true, path };
  }),
  browseVault: vi.fn(async () => ({ path: 'C:\\', parent: '', dirs: [] })),
}));

// The session of the storage reaches the network through `api/vault`, so the
// module is replaced: the test watches the calls instead of the requests.
vi.mock('../core/vault/session', () => ({
  detectVaultMode: vi.fn(async () => 'open'),
  getSealedVault: vi.fn(() => null),
  getVaultSessionState: vi.fn(() => ({ mode: 'open', locked: false, detecting: false, formatVersion: 0 })),
  lockVault: vi.fn(async () => undefined),
  subscribeVaultSession: vi.fn(() => () => undefined),
}));

/** A folder of the tree of a storage. */
function folder(path: string): Node {
  return {
    id: path,
    name: path.split(/[\\/]/).pop() ?? path,
    path,
    type: 'folder',
    parentPath: '',
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

describe('several storages at the same time', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    appStore.reset();
    server.current = '';
    server.trees = {
      'C:\\alpha': { folders: [folder('C:\\alpha\\one')], files: [] },
      'C:\\beta': { folders: [folder('C:\\beta\\two')], files: [] },
    };
  });

  afterEach(() => {
    appStore.reset();
    localStorage.clear();
  });

  it('keeps the trees of two storages apart', async () => {
    await appStore.actions.chooseVault('C:\\alpha');
    expect(appStore.getSnapshot().tree.folders.map((node) => node.path)).toEqual(['C:\\alpha\\one']);

    await appStore.actions.chooseVault('C:\\beta');
    expect(appStore.getSnapshot().tree.folders.map((node) => node.path)).toEqual(['C:\\beta\\two']);

    // The first storage is still open and keeps its own tree.
    expect(appStore.getSnapshot().ui.openStorages).toEqual(['C:\\beta', 'C:\\alpha']);

    await appStore.actions.switchStorage('C:\\alpha');
    expect(appStore.getSnapshot().tree.folders.map((node) => node.path)).toEqual(['C:\\alpha\\one']);
  });

  it('restores the state of the storage when the user comes back', async () => {
    await appStore.actions.chooseVault('C:\\alpha');
    await appStore.actions.openNote('C:\\alpha/one.md');
    expect(appStore.getSnapshot().note.path).toBe('C:\\alpha/one.md');
    appStore.actions.toggleFolder('C:\\alpha\\one');

    await appStore.actions.chooseVault('C:\\beta');
    expect(appStore.getSnapshot().note.path).toBeNull();

    await appStore.actions.switchStorage('C:\\alpha');
    const state = appStore.getSnapshot();
    // The note of the storage and the folders it had are back.
    expect(state.note.path).toBe('C:\\alpha/one.md');
    expect(state.note.content).toBe('text of C:\\alpha/one.md');
    expect([...state.ui.expanded].sort()).toEqual(['C:\\alpha', 'C:\\alpha\\one']);
  });

  it('makes a closed storage lose its state', async () => {
    await appStore.actions.chooseVault('C:\\alpha');
    await appStore.actions.chooseVault('C:\\beta');
    expect(appStore.getSnapshot().ui.openStorages).toEqual(['C:\\beta', 'C:\\alpha']);

    // The storage is closed: it is not open any more and it keeps nothing.
    appStore.actions.closeStorage('C:\\alpha');
    expect(appStore.getSnapshot().ui.openStorages).toEqual(['C:\\beta']);
    expect(storageRegistry.has('C:\\alpha')).toBe(false);

    // Opening it again starts from nothing: the tree is read from the server.
    await appStore.actions.switchStorage('C:\\alpha');
    expect(appStore.getSnapshot().tree.folders.map((node) => node.path)).toEqual(['C:\\alpha\\one']);
    expect(appStore.getSnapshot().note.path).toBeNull();
  });

  it('closes the storage that is open with its note and its tree', async () => {
    await appStore.actions.chooseVault('C:\\alpha');
    await appStore.actions.openNote('C:\\alpha/one.md');

    appStore.actions.closeStorage('C:\\alpha');

    const state = appStore.getSnapshot();
    expect(state.ui.openStorages).toEqual([]);
    expect(state.note.path).toBeNull();
    expect(state.tree.folders).toEqual([]);
  });

  it('refuses the switch of a storage that the environment has fixed', async () => {
    await appStore.actions.chooseVault('C:\\alpha');
    const { setVault } = await import('../api/client');
    vi.mocked(setVault).mockRejectedValueOnce(
      new (await import('../api/client')).ApiError(
        'vault_fixed',
        'The storage is fixed by the environment.',
        400,
      ),
    );

    await expect(appStore.actions.switchStorage('C:\\beta')).resolves.toBeUndefined();

    const state = appStore.getSnapshot();
    expect(state.ui.vaultFixed).toBe(true);
    expect(state.ui.vaultPath).toBe('C:\\alpha');
    expect(state.banner ?? '').toContain('NOTO_VAULT_FIXED');
  });
});
