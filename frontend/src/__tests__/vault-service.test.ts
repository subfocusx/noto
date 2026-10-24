// The contract of the service of the storage.
//
// The store must not know whether the notes are plain files or encrypted: it
// always talks to a `VaultService`. The test checks the two implementations
// of that contract and the switch between them.
import { describe, expect, it, vi } from 'vitest';
import type { Attachment, Node, NoteContent, TrashResponse, TreeResponse } from '../types';
import {
  createOpenVaultService,
  createSealedVaultService,
  getVaultService,
  setVaultService,
  VaultLockedError,
} from '../core/vault/vaultService';

const tree: TreeResponse = { folders: [], files: [], noteTotal: 0, folderTotal: 0 };
const note: NoteContent = {
  path: 'a.md',
  content: '# a',
  revision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
  conflict: false,
};
const node: Node = {
  id: 'x',
  name: 'a.md',
  path: 'a.md',
  type: 'file',
  parentPath: '',
  size: 3,
  modTime: note.updatedAt,
  revision: 1,
  createdAt: note.updatedAt,
  updatedAt: note.updatedAt,
};

describe('the service of the storage', () => {
  it('is the open one until the mode changes', () => {
    setVaultService(null);
    expect(getVaultService().mode).toBe('open');
  });

  it('keeps the service that the application installed', () => {
    const sealed = createSealedVaultService(makeVault());
    setVaultService(sealed);
    expect(getVaultService()).toBe(sealed);
    setVaultService(null);
    expect(getVaultService().mode).toBe('open');
  });
});

describe('the service of an open storage', () => {
  it('reads the tree, the notes and the trash', async () => {
    const service = createOpenVaultService();
    // The open service is a thin adapter: the calls go to the API of the notes.
    expect(service.mode).toBe('open');
    expect(typeof service.listTree).toBe('function');
    expect(typeof service.readNote).toBe('function');
    expect(typeof service.listTrash).toBe('function');
  });
});

describe('the service of an encrypted storage', () => {
  it('refuses to work while the storage is locked', async () => {
    const vault = makeVault({ unlocked: false });
    const service = createSealedVaultService(vault);
    await expect(service.listTree()).rejects.toBeInstanceOf(VaultLockedError);
    await expect(service.readNote('a.md')).rejects.toBeInstanceOf(VaultLockedError);
    await expect(service.saveNote('a.md', 'x')).rejects.toBeInstanceOf(VaultLockedError);
  });

  it('reads the tree and the notes through the vault', async () => {
    const vault = makeVault();
    const service = createSealedVaultService(vault);
    await expect(service.listTree()).resolves.toEqual(tree);
    await expect(service.readNote('a.md')).resolves.toEqual(note);
    await expect(service.saveNote('a.md', '# a')).resolves.toEqual({
      path: 'a.md',
      revision: 2,
      updatedAt: note.updatedAt,
    });
  });

  it('shows the notes with the paths of the open storage', async () => {
    // The encrypted storage knows the notes by their absolute path, the user
    // interface knows them by the path relative to the root of the vault.
    const vault = makeVault();
    vault.listTree.mockResolvedValue({
      folders: [],
      files: [{ ...node, path: '/notes/a.md', parentPath: '/notes' }],
    });
    vault.readNote.mockResolvedValue({ ...note, path: '/notes/a.md' });
    const service = createSealedVaultService(vault);

    const result = await service.listTree();
    expect(result.files[0]?.path).toBe('notes/a.md');
    expect(result.files[0]?.parentPath).toBe('notes');
    await expect(service.readNote('notes/a.md')).resolves.toEqual({
      ...note,
      path: 'notes/a.md',
    });
  });

  it('never touches the API of the notes', async () => {
    const vault = makeVault();
    const service = createSealedVaultService(vault);
    await service.deleteNote('a.md');
    expect(vault.deleteNote).toHaveBeenCalledWith('a.md');
  });
});

/** A vault that answers without a server. */
function makeVault(options: { unlocked?: boolean } = {}) {
  const unlocked = options.unlocked !== false;
  const trash: TrashResponse = { entries: [] };
  return {
    status: vi.fn(async () => ({ mode: 'sealed' as const, format: 1, objectCount: 1, generations: [1] })),
    isUnlocked: vi.fn(() => unlocked),
    unlock: vi.fn(async () => {}),
    lock: vi.fn(async () => {}),
    create: vi.fn(async () => {}),
    saveNote: vi.fn(async (path: string) => ({
      path,
      revision: 2,
      updatedAt: note.updatedAt,
    })),
    readNote: vi.fn(async () => note),
    listTree: vi.fn(async () => tree),
    createFolder: vi.fn(async (path: string) => ({ ...node, path, name: path })),
    createFile: vi.fn(async (path: string) => ({ ...node, path, name: path })),
    renameNote: vi.fn(async (path: string) => ({ ...node, path })),
    moveNode: vi.fn(async (path: string) => ({ ...node, path })),
    deleteNote: vi.fn(async () => {}),
    listTrash: vi.fn(async () => trash),
    restoreFromTrash: vi.fn(async (path: string) => ({ ...node, path })),
    search: vi.fn(async () => []),
    listAttachments: vi.fn(async (): Promise<Attachment[]> => []),
    uploadAttachment: vi.fn(
      async (name: string): Promise<Attachment> => ({
        id: 'a',
        name,
        mime: 'text/plain',
        size: 0,
        createdAt: note.updatedAt,
      }),
    ),
    deleteAttachment: vi.fn(async () => {}),
    integrityCheck: vi.fn(async () => ({ checked: 0, broken: [] })),
  };
}
