import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Sidebar } from '../components/Sidebar';
import { buildTree } from '../lib/tree';
import { appStore } from '../core/store/appStore';
import {
  DEFAULT_PREFS,
  EXPANDED_FOLDERS_LIMIT,
  PREFS_KEY,
  loadPrefs,
  savePrefs,
} from '../core/settings/prefs';
import type { Node } from '../types';

// The tree of the store comes from the server, so the client of the API is the
// only seam of this test.
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  getTree: vi.fn(async () => ({
    folders: [
      {
        id: 'journal',
        name: 'journal',
        path: 'journal',
        type: 'folder' as const,
        parentPath: '',
        size: 0,
        modTime: '',
        revision: 1,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'journal/2026',
        name: '2026',
        path: 'journal/2026',
        type: 'folder' as const,
        parentPath: 'journal',
        size: 0,
        modTime: '',
        revision: 1,
        createdAt: '',
        updatedAt: '',
      },
    ],
    files: [],
  })),
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
  getVault: vi.fn(async () => ({ configured: true, path: 'C:\\notes', notesDir: 'C:\\notes' })),
  setVault: vi.fn(async () => ({ ok: true, path: 'C:\\notes' })),
  browseVault: vi.fn(async () => ({ path: 'C:\\', parent: '', dirs: [] })),
}));

/** A folder of the vault. */
function folder(path: string, name: string, parentPath: string): Node {
  return {
    id: path,
    name,
    path,
    type: 'folder',
    parentPath,
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

/** Renders the sidebar of the explorer with the actions of the tree. */
function renderSidebar(overrides: Record<string, unknown> = {}) {
  const folders = [folder('journal', 'journal', ''), folder('journal/2026', '2026', 'journal')];
  const { roots, filesByParent } = buildTree(folders, []);
  return render(
    <Sidebar
      section="explorer"
      folders={roots}
      filesByParent={filesByParent}
      currentPath=""
      expanded={new Set<string>()}
      onToggle={() => undefined}
      onSelect={() => undefined}
      onCreateFolder={() => undefined}
      onCreateFile={() => undefined}
      onRename={() => undefined}
      onMove={() => undefined}
      onDelete={() => undefined}
      onOpenTransfer={() => undefined}
      onRefresh={() => undefined}
      loading={false}
      {...overrides}
    />,
  );
}

describe('opening and closing every folder at once', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The store is a singleton: it is rebuilt from the preferences of the
    // browser, so the storage is emptied and the state is reset before every
    // test. The preferences of one test never leak into the next one.
    localStorage.clear();
    appStore.reset();
  });

  it('offers the two actions in the group of the explorer', () => {
    renderSidebar();

    const title = screen.getByText('Explorer').closest('.sidebar-section-title');
    expect(title).not.toBeNull();
    for (const name of ['Expand all folders', 'Collapse all folders']) {
      const button = screen.getByRole('button', { name });
      expect(title?.contains(button)).toBe(true);
    }
  });

  it('calls the handlers of the two actions', () => {
    const onExpandAll = vi.fn();
    const onCollapseAll = vi.fn();
    renderSidebar({ onExpandAll, onCollapseAll });

    fireEvent.click(screen.getByRole('button', { name: 'Expand all folders' }));
    expect(onExpandAll).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all folders' }));
    expect(onCollapseAll).toHaveBeenCalled();
  });

  it('opens every folder of the storage and closes them again', async () => {
    await appStore.actions.refreshTree();

    appStore.actions.expandAllFolders();
    expect([...appStore.getSnapshot().ui.expanded].sort()).toEqual(['journal', 'journal/2026']);

    appStore.actions.collapseAllFolders();
    expect(appStore.getSnapshot().ui.expanded.size).toBe(0);
  });

  it('remembers the open folders after a reload', async () => {
    await appStore.actions.refreshTree();

    appStore.actions.expandAllFolders();
    expect(loadPrefs().expandedFolders).toContain('journal');
    expect(loadPrefs().expandedFolders).toContain('journal/2026');

    appStore.actions.collapseAllFolders();
    expect(loadPrefs().expandedFolders).toEqual([]);
  });

  it('changes nothing when every folder is opened a second time', async () => {
    await appStore.actions.refreshTree();

    appStore.actions.expandAllFolders();
    const first = [...appStore.getSnapshot().ui.expanded].sort();

    appStore.actions.expandAllFolders();
    expect([...appStore.getSnapshot().ui.expanded].sort()).toEqual(first);
    expect(first).toEqual(['journal', 'journal/2026']);
    expect([...loadPrefs().expandedFolders].sort()).toEqual(['journal', 'journal/2026']);
  });

  it('opens the folders that live inside another folder too', async () => {
    await appStore.actions.refreshTree();

    appStore.actions.expandAllFolders();
    const expanded = appStore.getSnapshot().ui.expanded;
    expect(expanded.has('journal')).toBe(true);
    expect(expanded.has('journal/2026')).toBe(true);
  });

  it('closes a single folder again after every folder was opened', async () => {
    await appStore.actions.refreshTree();

    appStore.actions.expandAllFolders();
    appStore.actions.toggleFolder('journal');

    expect([...appStore.getSnapshot().ui.expanded]).toEqual(['journal/2026']);
    expect(loadPrefs().expandedFolders).toEqual(['journal/2026']);
  });

  it('forgets the open folders when they are all closed', async () => {
    await appStore.actions.refreshTree();

    appStore.actions.expandAllFolders();
    appStore.actions.collapseAllFolders();

    expect(appStore.getSnapshot().ui.expanded.size).toBe(0);
    expect(loadPrefs().expandedFolders).toEqual([]);
  });

  it('opens nothing when the tree of the storage is not loaded yet', () => {
    // A preference that the store does not know is kept as it is.
    savePrefs({ ...DEFAULT_PREFS, autoLockMinutes: 42 });

    appStore.actions.expandAllFolders();

    expect(appStore.getSnapshot().ui.expanded.size).toBe(0);
    expect(loadPrefs().expandedFolders).toEqual([]);
    expect(loadPrefs().autoLockMinutes).toBe(42);
  });

  it('opens the same folders again when the state is rebuilt', async () => {
    await appStore.actions.refreshTree();

    appStore.actions.expandAllFolders();
    // The state of the application is rebuilt from the preferences, so the
    // folders that were open are open again.
    appStore.reset();

    expect([...appStore.getSnapshot().ui.expanded].sort()).toEqual(['journal', 'journal/2026']);
  });

  it('cuts the list of the open folders that comes from the storage', () => {
    const folders = Array.from(
      { length: EXPANDED_FOLDERS_LIMIT + 10 },
      (_, i) => `folder-${i}`,
    );
    localStorage.setItem(PREFS_KEY, JSON.stringify({ expandedFolders: folders }));

    const prefs = loadPrefs();
    expect(prefs.expandedFolders).toHaveLength(EXPANDED_FOLDERS_LIMIT);
    expect(prefs.expandedFolders).not.toContain(`folder-${EXPANDED_FOLDERS_LIMIT + 9}`);
  });
});
