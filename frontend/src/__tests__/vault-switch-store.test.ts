import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { appStore } from '../core/store/appStore';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from '../core/settings/prefs';
import { ApiError, getTree, setVault } from '../api/client';
import { detectVaultMode, lockVault } from '../core/vault/session';
import type { VaultChange } from '../api/vault';

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
  setVault: vi.fn(async () => ({ ok: true, path: 'C:\\notes' })),
  browseVault: vi.fn(async () => ({ path: 'C:\\', parent: '', dirs: [] })),
}));

// The session of the storage reaches the network through `api/vault`, so the
// module is replaced: the test watches the calls instead of the requests.
vi.mock('../core/vault/session', () => ({
  detectVaultMode: vi.fn(async () => 'open'),
  getSealedVault: vi.fn(() => null),
  lockVault: vi.fn(async () => undefined),
  subscribeVaultSession: vi.fn(() => () => undefined),
}));

/** The storage that the server refuses to change. */
function refusal(code: string, message: string): ApiError {
  return new ApiError(code, message, 400);
}

describe('the switch of the storage of the notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    appStore.reset();
    vi.mocked(setVault).mockResolvedValue({ ok: true, path: 'D:\\work' });
  });

  afterEach(() => {
    appStore.reset();
    localStorage.clear();
  });

  it('takes the new storage and remembers it as the newest one', async () => {
    await appStore.actions.chooseVault('D:\\work');

    const state = appStore.getSnapshot();
    expect(state.ui.vaultPath).toBe('D:\\work');
    expect(state.ui.vaultConfigured).toBe(true);
    expect(state.ui.vaultBusy).toBe(false);
    // The newest storage comes first.
    expect(state.ui.vaultRecents[0]).toBe('D:\\work');
    expect(loadPrefs().vaultRecents).toContain('D:\\work');
    // The tree of the new storage is read again.
    expect(vi.mocked(getTree)).toHaveBeenCalled();
  });

  it('refuses the switch and keeps the storage that was open', async () => {
    // The storage that is open now, with its recent list.
    vi.mocked(setVault).mockResolvedValue({ ok: true, path: 'C:\\notes' });
    await appStore.actions.chooseVault('C:\\notes');
    expect(appStore.getSnapshot().ui.vaultRecents).toEqual(['C:\\notes']);

    vi.mocked(setVault).mockRejectedValue(refusal('vault_error', 'The folder cannot be used.'));

    await expect(appStore.actions.chooseVault('D:\\work')).rejects.toThrow(
      'The folder cannot be used.',
    );

    const state = appStore.getSnapshot();
    expect(state.ui.vaultBusy).toBe(false);
    expect(state.ui.vaultPath).toBe('C:\\notes');
    // The recent storages did not change.
    expect(state.ui.vaultRecents).toEqual(['C:\\notes']);
    expect(loadPrefs().vaultRecents).toEqual(['C:\\notes']);
    // The store shows the reason of the refusal.
    expect(state.banner ?? '').toContain('The folder cannot be used.');
  });

  it('marks the storage as fixed when the environment refuses the switch', async () => {
    vi.mocked(setVault).mockResolvedValue({ ok: true, path: 'C:\\notes' });
    await appStore.actions.chooseVault('C:\\notes');

    vi.mocked(setVault).mockRejectedValue(
      refusal('vault_fixed', 'The storage is fixed by the environment.'),
    );

    // A fixed storage is a normal state of the environment: the promise
    // resolves, the caller is not told that something went wrong.
    await expect(appStore.actions.chooseVault('D:\\work')).resolves.toBeUndefined();

    const state = appStore.getSnapshot();
    expect(state.ui.vaultFixed).toBe(true);
    expect(state.ui.vaultBusy).toBe(false);
    expect(state.banner ?? '').toContain('NOTO_VAULT_FIXED');
    // The recent storages did not change.
    expect(state.ui.vaultRecents).toEqual(['C:\\notes']);
    expect(loadPrefs().vaultRecents).toEqual(['C:\\notes']);
  });

  it('forgets that the storage was fixed when the switch succeeds', async () => {
    // The environment refuses the switch: the storage is marked as fixed.
    vi.mocked(setVault).mockRejectedValue(
      refusal('vault_fixed', 'The storage is fixed by the environment.'),
    );
    await appStore.actions.chooseVault('C:\\notes');
    expect(appStore.getSnapshot().ui.vaultFixed).toBe(true);

    // The server accepts the change: the storage is not fixed any more.
    vi.mocked(setVault).mockResolvedValue({ ok: true, path: 'D:\\work' });
    await appStore.actions.chooseVault('D:\\work');

    expect(appStore.getSnapshot().ui.vaultFixed).toBe(false);
    expect(appStore.getSnapshot().ui.vaultPath).toBe('D:\\work');
  });

  it('is busy while the server has not answered yet', async () => {
    let release: (change: VaultChange) => void = () => undefined;
    vi.mocked(setVault).mockImplementation(
      () =>
        new Promise<VaultChange>((resolve) => {
          release = resolve;
        }),
    );

    const pending = appStore.actions.chooseVault('D:\\work');
    expect(appStore.getSnapshot().ui.vaultBusy).toBe(true);

    release({ ok: true, path: 'D:\\work' });
    await pending;
    expect(appStore.getSnapshot().ui.vaultBusy).toBe(false);
  });

  it('reads the mode of the new storage again, after the key material is dropped', async () => {
    await appStore.actions.chooseVault('D:\\work');

    expect(vi.mocked(lockVault)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(detectVaultMode)).toHaveBeenCalledTimes(1);
    // The key material of the previous storage goes first.
    const locked = vi.mocked(lockVault).mock.invocationCallOrder[0] ?? 0;
    const detected = vi.mocked(detectVaultMode).mock.invocationCallOrder[0] ?? 0;
    expect(locked).toBeLessThan(detected);
  });

  it('leaves the key material and the tree alone when the switch failed', async () => {
    await appStore.actions.loadVault();
    expect(appStore.getSnapshot().ui.vaultPath).toBe('C:\\notes');

    vi.mocked(setVault).mockRejectedValue(refusal('vault_error', 'The folder cannot be used.'));
    await expect(appStore.actions.chooseVault('D:\\work')).rejects.toThrow();

    expect(vi.mocked(lockVault)).not.toHaveBeenCalled();
    expect(vi.mocked(detectVaultMode)).not.toHaveBeenCalled();
    // The tree of the previous storage is still the one of the interface.
    expect(vi.mocked(getTree)).not.toHaveBeenCalled();
    expect(appStore.getSnapshot().ui.vaultPath).toBe('C:\\notes');
  });
});

describe('the quick menu of the storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    appStore.reset();
  });

  it('opens and closes with the action of the store', () => {
    expect(appStore.getSnapshot().ui.vaultMenuOpen).toBe(false);

    appStore.actions.setVaultMenuOpen(true);
    expect(appStore.getSnapshot().ui.vaultMenuOpen).toBe(true);

    appStore.actions.setVaultMenuOpen(false);
    expect(appStore.getSnapshot().ui.vaultMenuOpen).toBe(false);
  });
});

describe('the recent storages in the preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    appStore.reset();
  });

  it('survive a write of the preferences that does not carry them', () => {
    savePrefs({ ...DEFAULT_PREFS, vaultRecents: ['C:\\notes', 'D:\\work'] });

    // A write that knows nothing about the recent storages leaves them alone.
    const written: Partial<Prefs> = { ...DEFAULT_PREFS };
    delete written.vaultRecents;
    savePrefs(written as Prefs);

    expect(loadPrefs().vaultRecents).toEqual(['C:\\notes', 'D:\\work']);
  });

  it('are cleared by a write that carries the empty default list', () => {
    savePrefs({ ...DEFAULT_PREFS, vaultRecents: ['C:\\notes', 'D:\\work'] });

    // The default set carries an empty list of the recent storages, so a write
    // built from it replaces the list instead of leaving it alone.
    savePrefs({ ...DEFAULT_PREFS, theme: 'light' });

    expect(loadPrefs().vaultRecents).toEqual([]);
  });
});
