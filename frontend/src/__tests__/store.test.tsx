import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/preact';
import { App } from '../App';
import { getNote, saveNote } from '../api/client';
import { appStore } from '../core/store/appStore';

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
});
