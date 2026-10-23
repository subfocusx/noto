// The actions of the application store.
//
// Every user intent of the app ends up here: the actions mutate the state
// (see `./state.ts`) and talk to the API (see `../../api/client.ts`).
import {
  ApiError,
  createFile,
  createFolder,
  deleteNote,
  getNote,
  getTree,
  moveNote,
  renameNote,
  restoreNote,
  saveNote,
} from '../../api/client';
import { createAutosave, type AutosaveController, type AutosaveStatus } from '../../lib/autosave';
import { deleteDraft, getDraft, isDraftNewer, putDraft, type Draft } from '../../lib/drafts';
import { errorMessage } from '../../lib/errors';
import type { Node, NoteContent } from '../../types';
import { getSnapshot, patchNote, refs, update } from './state';
import type { DialogState, ViewMode } from './types';

const AUTOSAVE_DELAY = 800;

/* --------------------------------------------------------------- autosave */

function applyStatus(next: AutosaveStatus, error?: string): void {
  if (next === 'saved') patchNote({ status: next, dirty: false, saveError: null });
  else if (next === 'error') patchNote({ status: next, saveError: error ?? 'save failed' });
  else patchNote({ status: next });
}

async function saveNow(path: string, text: string, rev: number): Promise<void | number> {
  try {
    const res = await saveNote(path, text, rev);
    // Guard: never apply the response of an old note to the current one.
    if (refs.currentPath !== path) return;
    refs.revision = res.revision;
    patchNote({ revision: res.revision });
    // Only drop the local draft when it still matches what was saved.
    if (refs.content === text) {
      await deleteDraft(path).catch(() => undefined);
    }
    // The new revision is handed back so the next save uses it.
    return res.revision;
  } catch (err) {
    if (refs.currentPath !== path) return;
    const message = err instanceof ApiError ? err.message : errorMessage(err);
    patchNote({ saveError: message });
    // Keep the draft locally so that nothing is lost.
    await putDraft({ path, content: text, revision: rev, updatedAt: Date.now() }).catch(() => undefined);
    throw err;
  }
}

function createAutosaveController(): AutosaveController {
  return createAutosave({
    delay: AUTOSAVE_DELAY,
    save: saveNow,
    onStatus: applyStatus,
  });
}

let autosave: AutosaveController = createAutosaveController();

/** Cancels pending saves and starts with a fresh autosave controller. */
export function resetAutosave(): void {
  autosave.cancel();
  autosave = createAutosaveController();
}

/* ------------------------------------------------------------------ tree */

export async function refreshTree(): Promise<void> {
  update((prev) => ({ ...prev, tree: { ...prev.tree, loading: true } }));
  try {
    const res = await getTree();
    update((prev) => ({
      ...prev,
      tree: { ...prev.tree, folders: res.folders ?? [], files: res.files ?? [] },
    }));
  } catch (err) {
    showBanner(errorMessage(err));
  } finally {
    update((prev) => ({ ...prev, tree: { ...prev.tree, loading: false } }));
  }
}

export function toggleFolder(path: string): void {
  update((prev) => {
    const next = new Set(prev.ui.expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return { ...prev, ui: { ...prev.ui, expanded: next } };
  });
}

/** Expands every folder on the way to `path`. */
function expandTo(path: string): void {
  update((prev) => {
    const next = new Set(prev.ui.expanded);
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      next.add(parts.slice(0, i).join('/'));
    }
    return { ...prev, ui: { ...prev.ui, expanded: next } };
  });
}

/* ----------------------------------------------------------------- notes */

export async function openNote(path: string): Promise<void> {
  const previous = refs.currentPath;
  if (previous && previous !== path && autosave.dirty()) {
    // Flush pending edits of the previous note before switching.
    await autosave.flush();
  }
  autosave.cancel();
  autosave.setActivePath(path);

  // Reset the editor content before the note is loaded, so the text of the
  // previous note is never shown (or edited) while the new one loads.
  refs.content = '';
  refs.loadingPath = path;
  refs.currentPath = path;
  patchNote({
    path,
    content: '',
    contentPath: null,
    status: 'idle',
    saveError: null,
    dirty: false,
  });
  update((prev) => ({ ...prev, ui: { ...prev.ui, drawerOpen: false }, draftOffer: null }));

  try {
    const note: NoteContent = await getNote(path);
    if (refs.currentPath !== path) return;
    refs.loadingPath = null;
    const draft = await getDraft(path).catch(() => undefined);
    refs.revision = note.revision;
    refs.content = note.content;
    patchNote({ revision: note.revision, content: note.content, contentPath: path });
    autosave.markClean();
    if (draft && isDraftNewer(draft, note.updatedAt, note.content)) {
      // The local draft is newer: offer it, but never apply it silently.
      setDraftOffer(draft);
      return;
    }
    if (draft && draft.content === note.content) {
      await deleteDraft(path).catch(() => undefined);
    }
    expandTo(path);
  } catch (err) {
    refs.loadingPath = null;
    patchNote({ status: 'error', saveError: errorMessage(err) });
  }
}

export function editContent(text: string): void {
  const path = refs.currentPath;
  if (!path) return;
  // While the note is still loading its content is not editable.
  if (refs.loadingPath === path) return;
  refs.content = text;
  patchNote({ content: text, dirty: true });
  const draft: Draft = {
    path,
    content: text,
    revision: refs.revision,
    updatedAt: Date.now(),
  };
  void putDraft(draft).catch(() => undefined);
  autosave.markDirty(path, text, refs.revision);
}

export function explicitSave(): void {
  if (!refs.currentPath) return;
  void autosave.flush();
}

function setDraftOffer(draft: Draft | null): void {
  update((prev) => ({ ...prev, draftOffer: draft }));
}

export function restoreDraft(): void {
  const draft = getSnapshot().draftOffer;
  setDraftOffer(null);
  if (!draft) return;
  refs.content = draft.content;
  patchNote({ content: draft.content, contentPath: draft.path, dirty: true });
  autosave.setActivePath(draft.path);
  autosave.markDirty(draft.path, draft.content, refs.revision);
}

export function discardDraft(): void {
  const draft = getSnapshot().draftOffer;
  setDraftOffer(null);
  if (!draft) return;
  void deleteDraft(draft.path).catch(() => undefined);
}

/* -------------------------------------------------------- tree operations */

async function createFolderNode(parentPath: string, name: string): Promise<void> {
  await createFolder(parentPath, name);
  await refreshTree();
}

async function createFileNode(parentPath: string, name: string): Promise<void> {
  const node = await createFile(parentPath, name);
  await refreshTree();
  if (node?.path) await openNote(node.path);
}

export async function renameNode(node: Node, newName: string): Promise<void> {
  const renamed = await renameNote(node.path, newName);
  await refreshTree();
  if (refs.currentPath === node.path && renamed?.path) {
    refs.currentPath = renamed.path;
    patchNote({ path: renamed.path });
    autosave.setActivePath(renamed.path);
  }
}

export async function moveNode(node: Node, newParentPath: string): Promise<void> {
  const moved = await moveNote(node.path, newParentPath);
  await refreshTree();
  if (refs.currentPath === node.path && moved?.path) {
    refs.currentPath = moved.path;
    patchNote({ path: moved.path });
    autosave.setActivePath(moved.path);
  }
}

export async function deleteNode(node: Node): Promise<void> {
  await deleteNote(node.path);
  await refreshTree();
  if (refs.currentPath === node.path) {
    refs.currentPath = null;
    refs.content = '';
    patchNote({
      path: null,
      content: '',
      contentPath: null,
      status: 'idle',
      saveError: null,
      dirty: false,
    });
    autosave.setActivePath(null);
  }
}

/** Restores a note from the trash and returns the restored node. */
export async function restoreFromTrash(path: string): Promise<Node> {
  return restoreNote(path);
}

/* ----------------------------------------------------------- daily note */

/**
 * The file name of the daily note: the local date as `YYYY-MM-DD`.
 *
 * The local date is used on purpose: the note of the "23rd" must not depend
 * on the time zone of the server.
 */
export function dailyNoteName(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}.md`;
}

/**
 * Opens the daily note of the given day, creating it when it is missing.
 *
 * An existing note is never overwritten: it is simply opened. When a folder
 * with the same name is in the way, the user gets a message and nothing is
 * changed.
 */
export async function openOrCreateDailyNote(date: Date = new Date()): Promise<void> {
  const name = dailyNoteName(date);

  const { tree } = getSnapshot();
  // The daily note lives in the root of the library: only the root level is
  // looked at (the path of a root node is its name).
  const folder = tree.folders.find((node) => node.path === name);
  if (folder) {
    showBanner(`A folder named "${name}" already exists — the daily note was not created`);
    return;
  }

  const file = tree.files.find((node) => node.path === name);
  if (file) {
    await openNote(file.path);
    return;
  }

  try {
    // `createFile` creates the note, refreshes the tree and opens it.
    await createFileNode('', name);
  } catch (err) {
    // The tree may be out of date: the note might exist after all.
    await refreshTree().catch(() => undefined);
    const { tree: fresh } = getSnapshot();
    const existing = fresh.files.find((node) => node.path === name);
    if (existing) {
      await openNote(existing.path);
      return;
    }
    showBanner(errorMessage(err));
  }
}

/* ---------------------------------------------------------------- dialogs */

export function openDialog(dialog: DialogState): void {
  update((prev) => ({ ...prev, dialog }));
}

export function setDialogValue(value: string): void {
  update((prev) => ({ ...prev, dialog: { ...prev.dialog, value } }));
}

export function closeDialog(): void {
  update((prev) => ({ ...prev, dialog: { kind: null } }));
}

export async function confirmDialog(): Promise<void> {
  const kind = getSnapshot().dialog.kind;
  const node = getSnapshot().dialog.node;
  const value = getSnapshot().dialog.value ?? '';
  const parentPath = getSnapshot().dialog.parentPath ?? '';
  closeDialog();
  try {
    if (kind === 'create-folder') await createFolderNode(parentPath, value);
    else if (kind === 'create-file') await createFileNode(parentPath, value);
    else if (kind === 'rename' && node) await renameNode(node, value);
    else if (kind === 'move' && node) await moveNode(node, value);
    else if (kind === 'delete' && node) await deleteNode(node);
  } catch (err) {
    showBanner(errorMessage(err));
  }
}

/* --------------------------------------------------------------------- ui */

export function setMode(mode: ViewMode): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, mode } }));
}

export function setSearchOpen(open: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, searchOpen: open } }));
}

export function toggleDrawer(): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, drawerOpen: !prev.ui.drawerOpen } }));
}

export function closeDrawer(): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, drawerOpen: false } }));
}

/* ------------------------------------------------------------ environment */

/** Reflects the connectivity of the browser. */
export function setOnline(online: boolean): void {
  update((prev) => (prev.env.online === online ? prev : { ...prev, env: { ...prev.env, online } }));
}

/** Writes the theme into the document and into the local storage. */
export function applyTheme(theme: 'light' | 'dark'): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
  try {
    localStorage.setItem('noto-theme', theme);
  } catch {
    /* storage unavailable */
  }
}

export function toggleTheme(): void {
  const next = getSnapshot().env.theme === 'dark' ? 'light' : 'dark';
  update((prev) => ({ ...prev, env: { ...prev.env, theme: next } }));
  applyTheme(next);
}

/* ----------------------------------------------------------------- banner */

export function showBanner(message: string): void {
  update((prev) => ({ ...prev, banner: message }));
}

export function dismissBanner(): void {
  update((prev) => ({ ...prev, banner: null }));
}

/* ----------------------------------------------------------------- facade */

/** All actions the UI (and a plugin host) can trigger. */
export interface AppActions {
  refreshTree(): Promise<void>;
  openNote(path: string): Promise<void>;
  editContent(text: string): void;
  explicitSave(): void;
  toggleFolder(path: string): void;
  openDialog(dialog: DialogState): void;
  setDialogValue(value: string): void;
  closeDialog(): void;
  confirmDialog(): Promise<void>;
  createFolder(parentPath: string, name: string): Promise<void>;
  createFile(parentPath: string, name: string): Promise<void>;
  renameNode(node: Node, newName: string): Promise<void>;
  moveNode(node: Node, newParentPath: string): Promise<void>;
  deleteNode(node: Node): Promise<void>;
  restoreFromTrash(path: string): Promise<Node>;
  openOrCreateDailyNote(date?: Date): Promise<void>;
  restoreDraft(): void;
  discardDraft(): void;
  setMode(mode: ViewMode): void;
  setSearchOpen(open: boolean): void;
  toggleDrawer(): void;
  closeDrawer(): void;
  toggleTheme(): void;
  showBanner(message: string): void;
  dismissBanner(): void;
}

export const actions: AppActions = {
  refreshTree,
  openNote,
  editContent,
  explicitSave,
  toggleFolder,
  openDialog,
  setDialogValue,
  closeDialog,
  confirmDialog,
  createFolder: createFolderNode,
  createFile: createFileNode,
  renameNode,
  moveNode,
  deleteNode,
  restoreFromTrash,
  openOrCreateDailyNote,
  restoreDraft,
  discardDraft,
  setMode,
  setSearchOpen,
  toggleDrawer,
  closeDrawer,
  toggleTheme,
  showBanner,
  dismissBanner,
};
