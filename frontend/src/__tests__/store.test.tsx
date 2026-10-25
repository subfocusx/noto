import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { App } from '../App';
import { duplicateNote, getNote, getVault, saveNote } from '../api/client';
import { appStore } from '../core/store/appStore';
import { loadPrefs, RIGHT_PANEL_WIDTH_MAX, RIGHT_PANEL_WIDTH_MIN } from '../core/settings/prefs';

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  getTree: vi.fn(async () => ({ folders: [], files: [] })),
  getNote: vi.fn(async (path: string) => ({
    path,
    content: '# hello',
    revision: 1,
    updatedAt: new Date(0).toISOString(),
    conflict: false,
  })),
  saveNote: vi.fn(async (path: string) => ({ path, revision: 2, updatedAt: '' })),
  createFolder: vi.fn(async () => ({})),
  createFile: vi.fn(async () => ({})),
  renameNote: vi.fn(async () => ({})),
  moveNote: vi.fn(async () => ({})),
  deleteNote: vi.fn(async () => ({ ok: true })),
  duplicateNote: vi.fn(async () => ({
    id: 'a copy.md',
    name: 'a copy.md',
    path: 'a copy.md',
    type: 'file',
    parentPath: '',
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  })),
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

afterEach(() => {
  vi.clearAllMocks();
});

describe('app store', () => {
  it('loads a note into the store', async () => {
    const view = render(<App />);
    await appStore.actions.openNote('a.md');
    await waitFor(() => expect(appStore.getSnapshot().note.content).toBe('# hello'));
    expect(appStore.getSnapshot().note.path).toBe('a.md');
    expect(appStore.getSnapshot().note.contentPath).toBe('a.md');
    expect(appStore.getSnapshot().note.dirty).toBe(false);
    expect(vi.mocked(getNote)).toHaveBeenCalledWith('a.md');
    view.unmount();
  });

  it('marks the note dirty on an edit and saves it after the debounce delay', async () => {
    const view = render(<App />);
    await appStore.actions.openNote('a.md');
    await waitFor(() => expect(appStore.getSnapshot().note.content).toBe('# hello'));

    appStore.actions.editContent('changed');
    expect(appStore.getSnapshot().note.dirty).toBe(true);
    expect(vi.mocked(saveNote)).not.toHaveBeenCalled();

    await waitFor(() => expect(vi.mocked(saveNote)).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(vi.mocked(saveNote).mock.calls[0]?.[1]).toBe('changed');
    await waitFor(() => expect(appStore.getSnapshot().note.status).toBe('saved'));
    expect(appStore.getSnapshot().note.dirty).toBe(false);
    expect(appStore.getSnapshot().note.revision).toBe(2);
    view.unmount();
  });

  it('closes the note and empties the editor', async () => {
    const view = render(<App />);
    await appStore.actions.openNote('a.md');
    await waitFor(() => expect(appStore.getSnapshot().note.content).toBe('# hello'));

    await appStore.actions.closeNote();

    // The note is not in the editor any more: the closing of the last tab
    // must not leave the name of the note on the screen.
    expect(appStore.getSnapshot().note.path).toBeNull();
    expect(appStore.getSnapshot().note.content).toBe('');
    expect(appStore.getSnapshot().note.dirty).toBe(false);
    view.unmount();
  });

  it('saves the pending changes before the note leaves the screen', async () => {
    const view = render(<App />);
    await appStore.actions.openNote('a.md');
    await waitFor(() => expect(appStore.getSnapshot().note.content).toBe('# hello'));

    appStore.actions.editContent('# changed');
    await appStore.actions.closeNote();

    // The changes reached the disk: nothing is lost by closing the note.
    await waitFor(() => expect(vi.mocked(saveNote)).toHaveBeenCalled());
    expect(appStore.getSnapshot().note.path).toBeNull();
    view.unmount();
  });

  it('resets the state when the app is unmounted', async () => {
    const view = render(<App />);
    await appStore.actions.openNote('a.md');
    await waitFor(() => expect(appStore.getSnapshot().note.content).toBe('# hello'));
    view.unmount();
    expect(appStore.getSnapshot().note.path).toBeNull();
    expect(appStore.getSnapshot().note.content).toBe('');
    expect(appStore.getSnapshot().tree.folders).toEqual([]);
  });

  it('notifies the subscribers on every state change', async () => {
    const listener = vi.fn();
    const unsubscribe = appStore.subscribe(listener);
    appStore.actions.setMode('preview');
    expect(appStore.getSnapshot().ui.mode).toBe('preview');
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    appStore.actions.setMode('editor');
    expect(listener).not.toHaveBeenCalled();
    appStore.reset();
  });

  it('clamps the width of the right column and writes it back', () => {
    appStore.actions.setRightPanelWidth(10);
    expect(appStore.getSnapshot().ui.rightPanelWidth).toBe(RIGHT_PANEL_WIDTH_MIN);
    appStore.actions.setRightPanelWidth(5000);
    expect(appStore.getSnapshot().ui.rightPanelWidth).toBe(RIGHT_PANEL_WIDTH_MAX);
    appStore.actions.setRightPanelWidth(320);
    expect(appStore.getSnapshot().ui.rightPanelWidth).toBe(320);
    expect(loadPrefs().rightPanelWidth).toBe(320);
  });

  it('remembers the collapsed recent notes and the counts of the tree', () => {
    appStore.actions.setRecentCollapsed(true);
    appStore.actions.setTreeShowCounts(false);
    expect(appStore.getSnapshot().ui.recentCollapsed).toBe(true);
    expect(appStore.getSnapshot().ui.treeShowCounts).toBe(false);
    const prefs = loadPrefs();
    expect(prefs.recentCollapsed).toBe(true);
    expect(prefs.treeShowCounts).toBe(false);
    appStore.actions.setRecentCollapsed(false);
    appStore.actions.setTreeShowCounts(true);
  });

  it('reads the fixed flag of the storage', async () => {
    vi.mocked(getVault).mockResolvedValueOnce({
      configured: true,
      path: 'C:\\notes',
      notesDir: 'C:\\notes',
      fixed: true,
    });
    await appStore.actions.loadVault();
    expect(appStore.getSnapshot().ui.vaultFixed).toBe(true);
    expect(appStore.getSnapshot().ui.vaultPath).toBe('C:\\notes');
    vi.mocked(getVault).mockResolvedValueOnce({
      configured: true,
      path: 'C:\\notes',
      notesDir: 'C:\\notes',
      fixed: false,
    });
    await appStore.actions.loadVault();
    expect(appStore.getSnapshot().ui.vaultFixed).toBe(false);
  });

  it('duplicates the open note and opens the copy', async () => {
    const view = render(<App />);
    await appStore.actions.openNote('a.md');
    await waitFor(() => expect(appStore.getSnapshot().note.content).toBe('# hello'));

    await appStore.actions.duplicateNote('a.md');

    expect(vi.mocked(duplicateNote)).toHaveBeenCalledWith('a.md');
    await waitFor(() => expect(appStore.getSnapshot().note.path).toBe('a copy.md'));
    view.unmount();
  });
});
