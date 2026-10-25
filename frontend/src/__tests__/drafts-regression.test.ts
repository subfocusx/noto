// The drafts of the notes.
//
// A draft is the unsaved work of a note, kept in the database of the browser
// so that nothing is lost when the backend does not answer. The helper
// (`lib/drafts.ts`) is covered by `drafts.test.ts` and the encrypted drafts
// by `sealed-drafts.test.ts`: this file covers the *flow* of a draft — the
// save, the load, the restore, the discard and the expiry — at the level of
// the store, which is where the user meets it.
//
// The gaps that the test finds are written in the comments: the behaviour is
// not changed here, it is only described.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { appStore } from '../core/store/appStore';
import { deleteDraft, getDraft, listDrafts, putDraft } from '../lib/drafts';

// The tree and the notes come from the server, so the client of the API is
// the only seam of this test.
const server = vi.hoisted(() => ({
  note: { path: 'note.md', content: 'text of the server', revision: 3, updatedAt: '' },
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
  getTree: vi.fn(async () => ({ folders: [], files: [] })),
  getNote: vi.fn(async (path: string) => ({ ...server.note, path })),
  saveNote: vi.fn(async (path: string) => ({ path, revision: 4, updatedAt: '' })),
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
    path: '',
    notesDir: '',
    fixed: false,
  })),
  setVault: vi.fn(async (path: string) => ({ ok: true, path })),
  browseVault: vi.fn(async () => ({ path: 'C:\\', parent: '', dirs: [] })),
}));

vi.mock('../core/vault/session', () => ({
  detectVaultMode: vi.fn(async () => 'open'),
  getSealedVault: vi.fn(() => null),
  getVaultSessionState: vi.fn(() => ({ mode: 'open', locked: false, detecting: false, formatVersion: 0 })),
  lockVault: vi.fn(async () => undefined),
  subscribeVaultSession: vi.fn(() => () => undefined),
}));

/** Waits for the pending promises of the test. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the drafts of the notes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    appStore.reset();
    for (const draft of await listDrafts()) {
      await deleteDraft(draft.path);
    }
  });

  afterEach(() => {
    appStore.reset();
  });

  it('saves the draft of a note and loads it back', async () => {
    await putDraft({ path: 'note.md', content: 'local text', revision: 3, updatedAt: Date.now() });

    const draft = await getDraft('note.md');
    expect(draft?.content).toBe('local text');
    expect(draft?.revision).toBe(3);
  });

  it('offers the draft of a note that is newer than the copy of the server', async () => {
    await putDraft({
      path: 'note.md',
      content: 'local text',
      revision: 3,
      updatedAt: Date.now(),
    });

    await appStore.actions.openNote('note.md');

    const state = appStore.getSnapshot();
    // The draft is offered, never applied silently.
    expect(state.draftOffer?.content).toBe('local text');
    expect(state.note.content).toBe('text of the server');
  });

  it('restores the draft when the user accepts it', async () => {
    await putDraft({
      path: 'note.md',
      content: 'local text',
      revision: 3,
      updatedAt: Date.now(),
    });
    await appStore.actions.openNote('note.md');

    appStore.actions.restoreDraft();

    const state = appStore.getSnapshot();
    expect(state.draftOffer).toBeNull();
    expect(state.note.content).toBe('local text');
    expect(state.note.dirty).toBe(true);
  });

  it('discards the draft when the user refuses it', async () => {
    await putDraft({
      path: 'note.md',
      content: 'local text',
      revision: 3,
      updatedAt: Date.now(),
    });
    await appStore.actions.openNote('note.md');

    appStore.actions.discardDraft();
    await tick();

    expect(appStore.getSnapshot().draftOffer).toBeNull();
    expect(await getDraft('note.md')).toBeUndefined();
  });

  it('does not offer a draft that holds the text of the server', async () => {
    await putDraft({
      path: 'note.md',
      content: 'text of the server',
      revision: 3,
      updatedAt: Date.now(),
    });

    await appStore.actions.openNote('note.md');
    await tick();

    expect(appStore.getSnapshot().draftOffer).toBeNull();
    // The draft is useless: it is dropped.
    expect(await getDraft('note.md')).toBeUndefined();
  });

  it('never expires a draft', async () => {
    // GAP: the drafts have no expiry. A draft of a year ago is still offered
    // to the user, and it stays in the database of the browser until it is
    // saved or thrown away. The test describes the behaviour of today; the
    // expiry is not implemented.
    await putDraft({
      path: 'note.md',
      content: 'local text',
      revision: 1,
      updatedAt: 0,
    });

    await appStore.actions.openNote('note.md');

    const state = appStore.getSnapshot();
    expect(state.draftOffer?.content).toBe('local text');
    expect(await getDraft('note.md')).toBeDefined();
  });

  it('keeps the draft when the copy of the server has no date', async () => {
    // A server that answers without a date cannot prove that its copy is
    // the newest one: the draft is kept and offered.
    await putDraft({
      path: 'note.md',
      content: 'local text',
      revision: 1,
      updatedAt: 1000,
    });

    await appStore.actions.openNote('note.md');

    expect(appStore.getSnapshot().draftOffer?.content).toBe('local text');
  });
});
