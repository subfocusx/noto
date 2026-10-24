// The actions of the application store.
//
// Every user intent of the app ends up here: the actions mutate the state
// (see `./state.ts`) and talk to the storage of the notes. The storage is
// reached through the service of the current mode (see `../vault/vaultService.ts`):
// the store does not know whether the notes are plain files or encrypted.
import { ApiError, getVault, setVault } from '../../api/client';
import { createAutosave, type AutosaveController, type AutosaveStatus } from '../../lib/autosave';
import { deleteDraft, getDraft, isDraftNewer, putDraft, type Draft } from '../../lib/drafts';
import { errorMessage } from '../../lib/errors';
import type { Node, NoteContent } from '../../types';
import {
  clampRightPanelWidth,
  pushRecent as pushRecentPath,
  removeRecent as removeRecentPath,
  savePrefs,
  type ThemePreference,
  type TreeSort,
} from '../settings/prefs';
import { getSnapshot, patchNote, refs, resolveTheme, update } from './state';
import type { ContextMenuState, DialogState, ViewMode } from './types';
import type { ConnectionState } from '../connection/types';
import { connectionMonitor } from '../connection/monitor';
import { getQueryService } from '../query/service';
import { getVaultService } from '../vault/vaultService';
import { getSealedVault } from '../vault/session';
import {
  deleteSealedDraft,
  getSealedDraft,
  putSealedDraft,
} from '../vault/sealedDrafts';

/**
 * Writes a local draft.
 *
 * The draft of an encrypted storage is sealed: the database of the browser
 * must not hold the text of a note in the clear.
 */
async function storeDraft(draft: Draft): Promise<void> {
  const vault = getVaultService().mode === 'sealed' ? getSealedVault() : null;
  if (vault) {
    await putSealedDraft(vault, draft);
    return;
  }
  await putDraft(draft);
}

/** Reads a local draft. */
async function readDraft(path: string): Promise<Draft | undefined> {
  const vault = getVaultService().mode === 'sealed' ? getSealedVault() : null;
  if (vault) return getSealedDraft(vault, path);
  return getDraft(path);
}

/** Removes a local draft. */
async function dropDraft(path: string): Promise<void> {
  const vault = getVaultService().mode === 'sealed' ? getSealedVault() : null;
  if (vault) {
    await deleteSealedDraft(path);
    return;
  }
  await deleteDraft(path);
}

const AUTOSAVE_DELAY = 800;

/**
 * Writes the visual state into the storage of the user.
 *
 * The preferences are the only part of the state that survives a reload, so
 * every change of the theme, the mode, the sidebar or the tree writes them.
 */
function persistPrefs(): void {
  const state = getSnapshot();
  savePrefs({
    theme: state.env.theme,
    mode: state.ui.mode,
    sidebarCollapsed: state.ui.sidebarCollapsed,
    sidebarWidth: state.ui.sidebarWidth,
    treeSort: state.ui.treeSort,
    editorFontSize: state.ui.editorFontSize,
    editorWrap: state.ui.editorWrap,
    expandedFolders: [...state.ui.expanded],
    recentPaths: state.ui.recentPaths,
    rightPanelVisible: state.ui.rightPanelVisible,
    rightPanelPinned: state.ui.rightPanelPinned,
    rightPanelWidth: state.ui.rightPanelWidth,
    recentCollapsed: state.ui.recentCollapsed,
    treeShowCounts: state.ui.treeShowCounts,
  });
}

/* --------------------------------------------------------------- autosave */

function applyStatus(next: AutosaveStatus, error?: string): void {
  if (next === 'saved') patchNote({ status: next, dirty: false, saveError: null });
  else if (next === 'error') patchNote({ status: next, saveError: error ?? 'save failed' });
  else patchNote({ status: next });
}

async function saveNow(path: string, text: string, rev: number): Promise<void | number> {
  try {
    const res = await getVaultService().saveNote(path, text, rev);
    // Guard: never apply the response of an old note to the current one.
    if (refs.currentPath !== path) return;
    refs.revision = res.revision;
    patchNote({ revision: res.revision });
    // Only drop the local draft when it still matches what was saved.
    if (refs.content === text) {
      await dropDraft(path).catch(() => undefined);
    }
    // The new revision is handed back so the next save uses it.
    return res.revision;
  } catch (err) {
    if (refs.currentPath !== path) return;
    const message = err instanceof ApiError ? err.message : errorMessage(err);
    patchNote({ saveError: message });
    // Keep the draft locally so that nothing is lost.
    await storeDraft({ path, content: text, revision: rev, updatedAt: Date.now() }).catch(() => undefined);
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
    const res = await getVaultService().listTree();
    update((prev) => ({
      ...prev,
      tree: {
        ...prev.tree,
        folders: res.folders ?? [],
        files: res.files ?? [],
        noteTotal: res.noteTotal ?? res.files?.length ?? 0,
        folderTotal: res.folderTotal ?? res.folders?.length ?? 0,
      },
    }));
  } catch (err) {
    reportError(err);
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
  persistPrefs();
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
  update((prev) => ({
    ...prev,
    ui: {
      ...prev.ui,
      drawerOpen: false,
      // The note joins the tab strip of the editor, whatever opened it.
      openPaths: prev.ui.openPaths.includes(path)
        ? prev.ui.openPaths
        : [...prev.ui.openPaths, path],
    },
    draftOffer: null,
  }));

  try {
    const note: NoteContent = await getVaultService().readNote(path);
    if (refs.currentPath !== path) return;
    refs.loadingPath = null;
    const draft = await readDraft(path).catch(() => undefined);
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
      await dropDraft(path).catch(() => undefined);
    }
    expandTo(path);
    // The note joins the list of the recently opened notes.
    update((prev) => ({
      ...prev,
      ui: { ...prev.ui, recentPaths: pushRecentPath(prev.ui.recentPaths, path) },
    }));
    persistPrefs();
  } catch (err) {
    refs.loadingPath = null;
    patchNote({ status: 'error', saveError: errorMessage(err) });
  }
}

/**
 * Closes a tab of the editor.
 *
 * The note itself is not deleted: the tab is only closed, and the note stays
 * in the vault.
 */
export function closeTab(path: string): void {
  update((prev) => ({
    ...prev,
    ui: { ...prev.ui, openPaths: prev.ui.openPaths.filter((item) => item !== path) },
  }));
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
  void storeDraft(draft).catch(() => undefined);
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
  void dropDraft(draft.path).catch(() => undefined);
}

/* -------------------------------------------------------- tree operations */

async function createFolderNode(parentPath: string, name: string): Promise<void> {
  await getVaultService().createFolder(parentPath, name);
  await refreshTree();
}

async function createFileNode(parentPath: string, name: string): Promise<void> {
  const node = await getVaultService().createFile(parentPath, name);
  await refreshTree();
  if (node?.path) await openNote(node.path);
}

/**
 * Copies the note and opens the copy.
 *
 * The copy is created by the server; the tree is read again and the new note
 * is opened like any other note of the tree.
 */
export async function duplicateNote(path: string): Promise<void> {
  try {
    const copy = await getVaultService().duplicateNote(path);
    await refreshTree();
    if (copy?.path) await openNote(copy.path);
  } catch (err) {
    reportError(err);
  }
}

export async function renameNode(node: Node, newName: string): Promise<void> {
  const renamed = await getVaultService().renameNote(node.path, newName);
  await refreshTree();
  if (refs.currentPath === node.path && renamed?.path) {
    refs.currentPath = renamed.path;
    patchNote({ path: renamed.path });
    autosave.setActivePath(renamed.path);
  }
}

export async function moveNode(node: Node, newParentPath: string): Promise<void> {
  const moved = await getVaultService().moveNote(node.path, newParentPath);
  await refreshTree();
  if (refs.currentPath === node.path && moved?.path) {
    refs.currentPath = moved.path;
    patchNote({ path: moved.path });
    autosave.setActivePath(moved.path);
  }
}

export async function deleteNode(node: Node): Promise<void> {
  await getVaultService().deleteNote(node.path);
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
  return getVaultService().restoreNote(path);
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
    reportError(err);
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
    reportError(err);
  }
}

/* --------------------------------------------------------------------- ui */

export function setMode(mode: ViewMode): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, mode } }));
  persistPrefs();
}

export function setSearchOpen(open: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, searchOpen: open } }));
}

/** Opens or closes the command palette. */
export function setPaletteOpen(open: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, paletteOpen: open } }));
}

/** Switches the command palette. */
export function togglePalette(): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, paletteOpen: !prev.ui.paletteOpen } }));
}

export function toggleDrawer(): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, drawerOpen: !prev.ui.drawerOpen } }));
}

export function closeDrawer(): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, drawerOpen: false } }));
}

/** Opens a folder in the tree (it stays open). */
export function expandFolder(path: string): void {
  update((prev) => {
    if (prev.ui.expanded.has(path)) return prev;
    const next = new Set(prev.ui.expanded);
    next.add(path);
    return { ...prev, ui: { ...prev.ui, expanded: next } };
  });
  persistPrefs();
}

/** Collapses or expands the sidebar of the notes. */
export function setSidebarCollapsed(collapsed: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, sidebarCollapsed: collapsed } }));
  persistPrefs();
}

export function toggleSidebar(): void {
  setSidebarCollapsed(!getSnapshot().ui.sidebarCollapsed);
}

/** Changes the width of the sidebar; the value is clamped. */
export function setSidebarWidth(width: number): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, sidebarWidth: width } }));
  persistPrefs();
}

/** Changes the sort order of the tree. */
export function setTreeSort(sort: TreeSort): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, treeSort: sort } }));
  persistPrefs();
}

/** Changes the font size of the editor. */
export function setEditorFontSize(size: number): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, editorFontSize: size } }));
  persistPrefs();
}

/** Turns the wrapping of the long lines in the editor on or off. */
export function setEditorWrap(wrap: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, editorWrap: wrap } }));
  persistPrefs();
}

/** Opens the context menu of the tree. */
export function openContextMenu(menu: ContextMenuState): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, contextMenu: menu } }));
}

/** Closes the context menu of the tree. */
export function closeContextMenu(): void {
  update((prev) =>
    prev.ui.contextMenu ? { ...prev, ui: { ...prev.ui, contextMenu: null } } : prev,
  );
}

export function setSettingsOpen(open: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, settingsOpen: open } }));
}

export function setShortcutHelpOpen(open: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, shortcutHelpOpen: open } }));
}

/* ---------------------------------------------------------- right panel */

/** Shows or hides the right panel (the outline of the note). */
export function setRightPanelVisible(visible: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, rightPanelVisible: visible } }));
  persistPrefs();
}

/** Switches the right panel. */
export function toggleRightPanel(): void {
  setRightPanelVisible(!getSnapshot().ui.rightPanelVisible);
}

/** Pins the right panel open on narrow screens. */
export function setRightPanelPinned(pinned: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, rightPanelPinned: pinned } }));
  persistPrefs();
}

/** Changes the width of the right column; the value is clamped. */
export function setRightPanelWidth(width: number): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, rightPanelWidth: clampRightPanelWidth(width) } }));
  persistPrefs();
}

/** Collapses or expands the list of the recent notes. */
export function setRecentCollapsed(collapsed: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, recentCollapsed: collapsed } }));
  persistPrefs();
}

/** Shows or hides the number of the notes next to a folder of the tree. */
export function setTreeShowCounts(show: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, treeShowCounts: show } }));
  persistPrefs();
}

/* ----------------------------------------------------------------- query */

/**
 * Sets the query of the interface, without running it.
 *
 * The action is the one of the text field: the query is run separately, so
 * the user can type a query that is not complete yet.
 */
export function setQuery(text: string): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, query: text } }));
}

/**
 * Runs a query and fills the answer in the state.
 *
 * The action never throws: a broken query is shown as a message in the query
 * bar. The answer of a query that is not the current one any more is dropped.
 */
export async function runQuery(text?: string, limit?: number): Promise<void> {
  const current = getSnapshot().ui.query;
  const query = (text ?? current).trim();
  if (text !== undefined && text !== current) setQuery(text);
  if (!query) {
    clearQuery();
    return;
  }

  const outcome = await getQueryService().runQuery(query, limit ?? 50);
  // The user typed something else while the query was running.
  if (getSnapshot().ui.query.trim() !== query) return;
  update((prev) => ({
    ...prev,
    ui: {
      ...prev.ui,
      queryHits: outcome.hits,
      queryTotal: outcome.total,
      queryPartial: outcome.partial,
      queryError: outcome.error ? outcome.error.message : null,
    },
  }));
}

/** Empties the query and forgets the answer. */
export function clearQuery(): void {
  update((prev) => ({
    ...prev,
    ui: {
      ...prev.ui,
      query: '',
      queryHits: [],
      queryTotal: 0,
      queryPartial: false,
      queryError: null,
    },
  }));
}

/** Reads the tags of the vault and fills them in the state. */
export async function loadTags(): Promise<void> {
  try {
    const tags = await getQueryService().loadTags();
    update((prev) => ({ ...prev, ui: { ...prev.ui, tags } }));
  } catch (err) {
    reportError(err);
  }
}

/* ----------------------------------------------------------------- vault */

/** Reads the state of the storage of the notes. */
export async function loadVault(): Promise<void> {
  try {
    const info = await getVault();
    update((prev) => ({
      ...prev,
      ui: {
        ...prev.ui,
        vaultConfigured: info.configured,
        vaultPath: info.path ?? '',
        vaultFixed: info.fixed === true,
      },
    }));
  } catch (err) {
    reportError(err);
  }
}

/**
 * Chooses the folder with the notes.
 *
 * The server switches to the new folder; the tree of the notes is read again,
 * so the interface shows the notes of the new storage at once.
 */
export async function chooseVault(path: string): Promise<void> {
  update((prev) => ({ ...prev, ui: { ...prev.ui, vaultBusy: true } }));
  try {
    const info = await setVault(path);
    update((prev) => ({
      ...prev,
      ui: {
        ...prev.ui,
        vaultConfigured: true,
        vaultPath: info.path ?? path,
        vaultBusy: false,
      },
    }));
    await refreshTree();
  } catch (err) {
    update((prev) => ({ ...prev, ui: { ...prev.ui, vaultBusy: false } }));
    // A fixed storage is a normal state of the environment, not a failure.
    if (err instanceof ApiError && err.code === 'vault_fixed') {
      update((prev) => ({ ...prev, ui: { ...prev.ui, vaultFixed: true } }));
      showBanner('The storage is fixed by the environment (NOTO_VAULT_FIXED).');
      return;
    }
    reportError(err);
    throw err;
  }
}

/** Adds a note to the list of the recently opened notes. */
export function addRecent(path: string): void {
  update((prev) => ({
    ...prev,
    ui: { ...prev.ui, recentPaths: pushRecentPath(prev.ui.recentPaths, path) },
  }));
  persistPrefs();
}

/** Removes a note from the list of the recently opened notes. */
export function removeRecent(path: string): void {
  update((prev) => ({
    ...prev,
    ui: { ...prev.ui, recentPaths: removeRecentPath(prev.ui.recentPaths, path) },
  }));
  persistPrefs();
}

/* ------------------------------------------------------------ environment */

/** Reflects the connectivity of the browser. */
export function setOnline(online: boolean): void {
  update((prev) => (prev.env.online === online ? prev : { ...prev, env: { ...prev.env, online } }));
}

/**
 * Publishes the state of the connection with the backend.
 *
 * The state is separate from the connectivity of the browser: a browser can
 * be online while the backend does not answer.
 */
export function setConnection(connection: ConnectionState): void {
  update((prev) =>
    prev.env.connection === connection
      ? prev
      : { ...prev, env: { ...prev.env, connection } },
  );
}

/**
 * Writes the theme into the document.
 *
 * An explicit choice is written as `data-theme`; the `system` theme removes
 * the attribute, so the stylesheet follows the operating system.
 */
export function applyTheme(theme: ThemePreference): void {
  if (typeof document !== 'undefined') {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }
}

/** Sets the theme of the user: an explicit choice or the system theme. */
export function setTheme(theme: ThemePreference): void {
  const effective = resolveTheme(theme);
  update((prev) => ({ ...prev, env: { ...prev.env, theme, effectiveTheme: effective } }));
  applyTheme(theme);
  persistPrefs();
}

/** Reflects the theme of the operating system (only for the `system` theme). */
export function setEffectiveTheme(theme: 'light' | 'dark'): void {
  update((prev) =>
    prev.env.effectiveTheme === theme
      ? prev
      : { ...prev, env: { ...prev.env, effectiveTheme: theme } },
  );
}

/** Switches between the light and the dark theme. */
export function toggleTheme(): void {
  const current = getSnapshot().env.effectiveTheme;
  setTheme(current === 'dark' ? 'light' : 'dark');
}

/* ----------------------------------------------------------------- banner */

export function showBanner(message: string): void {
  update((prev) => ({ ...prev, banner: message }));
}

/**
 * Reports a failed operation to the user.
 *
 * A lost connection is not a failure of the application: the backend simply
 * does not answer. Such an error changes the state of the connection, which
 * the indicator shows, and it must not fill the screen with a red banner
 * every time a background request fails.
 */
export function reportError(err: unknown): void {
  if (err instanceof ApiError && err.code === 'network_error') {
    connectionMonitor.reportFailure();
    return;
  }
  showBanner(errorMessage(err));
}

export function dismissBanner(): void {
  update((prev) => ({ ...prev, banner: null }));
}

/* ----------------------------------------------------------------- facade */

/** All actions the UI (and a plugin host) can trigger. */
export interface AppActions {
  refreshTree(): Promise<void>;
  openNote(path: string): Promise<void>;
  closeTab(path: string): void;
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
  setPaletteOpen(open: boolean): void;
  togglePalette(): void;
  toggleDrawer(): void;
  closeDrawer(): void;
  toggleTheme(): void;
  setTheme(theme: ThemePreference): void;
  setEffectiveTheme(theme: 'light' | 'dark'): void;
  applyTheme(theme: ThemePreference): void;
  expandFolder(path: string): void;
  setSidebarCollapsed(collapsed: boolean): void;
  toggleSidebar(): void;
  setSidebarWidth(width: number): void;
  setTreeSort(sort: TreeSort): void;
  setEditorFontSize(size: number): void;
  setEditorWrap(wrap: boolean): void;
  openContextMenu(menu: ContextMenuState): void;
  closeContextMenu(): void;
  setSettingsOpen(open: boolean): void;
  setShortcutHelpOpen(open: boolean): void;
  setRightPanelVisible(visible: boolean): void;
  toggleRightPanel(): void;
  setRightPanelPinned(pinned: boolean): void;
  setRightPanelWidth(width: number): void;
  setRecentCollapsed(collapsed: boolean): void;
  setTreeShowCounts(show: boolean): void;
  setQuery(text: string): void;
  runQuery(text?: string, limit?: number): Promise<void>;
  clearQuery(): void;
  loadTags(): Promise<void>;
  loadVault(): Promise<void>;
  chooseVault(path: string): Promise<void>;
  duplicateNote(path: string): Promise<void>;
  addRecent(path: string): void;
  removeRecent(path: string): void;
  showBanner(message: string): void;
  dismissBanner(): void;
  setConnection(connection: ConnectionState): void;
}

export const actions: AppActions = {
  refreshTree,
  openNote,
  closeTab,
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
  setPaletteOpen,
  togglePalette,
  toggleDrawer,
  closeDrawer,
  toggleTheme,
  setTheme,
  setEffectiveTheme,
  applyTheme,
  expandFolder,
  setSidebarCollapsed,
  toggleSidebar,
  setSidebarWidth,
  setTreeSort,
  setEditorFontSize,
  setEditorWrap,
  openContextMenu,
  closeContextMenu,
  setSettingsOpen,
  setShortcutHelpOpen,
  setRightPanelVisible,
  toggleRightPanel,
  setRightPanelPinned,
  setRightPanelWidth,
  setRecentCollapsed,
  setTreeShowCounts,
  setQuery,
  runQuery,
  clearQuery,
  loadTags,
  loadVault,
  chooseVault,
  duplicateNote,
  addRecent,
  removeRecent,
  showBanner,
  dismissBanner,
  setConnection,
};
