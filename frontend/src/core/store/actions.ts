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
import { publishPendingSync } from './offlineQueue';
import type { Node, NoteContent } from '../../types';
import {
  clampRightPanelWidth,
  pushRecent as pushRecentPath,
  pushVaultRecent,
  removeRecent as removeRecentPath,
  savePrefs,
  type ThemePreference,
  type TreeSort,
} from '../settings/prefs';
import { getSnapshot, patchNote, refs, resolveTheme, update } from './state';
import type { ContextMenuState, DialogState, FindMode, RailSection, ViewMode } from './types';
import { asksForName } from './types';
import {
  clearNotifications as clearNotificationList,
  createNotification,
  dismissNotification as dismissFromList,
  markAllNotificationsRead as markAllInList,
  markNotificationRead as markInList,
  pushNotification as pushToList,
  type NotificationInput,
} from '../notifications/types';
import {
  saveFavorites,
  toggleFavorite as toggleInFavorites,
} from '../favorites/types';
import {
  addReminder as addToReminders,
  removeReminder as removeFromReminders,
  saveReminders,
  type Reminder,
} from '../reminders/types';
import type { ConnectionState } from '../connection/types';
import { connectionMonitor } from '../connection/monitor';
import { getVaultService } from '../vault/vaultService';
import { detectVaultMode, getSealedVault, lockVault } from '../vault/session';
import { storageRegistry } from '../storages/storageRegistry';
import {
  applyStorageState,
  captureStorageState,
  emptyStorageState,
  storageKey,
  type StorageState,
} from '../storages/storageState';
import {
  STORAGE_FIXED_MESSAGE,
  storageFixedExplanation,
} from '../storages/fixedStorage';
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
    railSection: state.ui.railSection,
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
    vaultRecents: state.ui.vaultRecents,
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
    // The tags of the vault follow the text of the notes.
    scheduleTagsRefresh();
    // The new revision is handed back so the next save uses it.
    return res.revision;
  } catch (err) {
    if (refs.currentPath !== path) return;
    const message = err instanceof ApiError ? err.message : errorMessage(err);
    // A conflict is not a failure of the save: the note on the server is not
    // the note of the editor. The user decides what happens next, so the
    // conflict goes to the dialog instead of the status bar.
    if (err instanceof ApiError && err.code === 'revision_conflict' && err.current) {
      patchNote({
        status: 'error',
        saveError: null,
        conflict: {
          path,
          serverContent: err.current.content,
          serverRevision: err.current.revision,
          serverUpdatedAt: err.current.updatedAt,
        },
      });
      await storeDraft({ path, content: text, revision: rev, updatedAt: Date.now() }).catch(() => undefined);
      return;
    }
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

/**
 * Opens every folder of the storage at once.
 *
 * The tree of the storage is flat in the state, so the paths of the folders are
 * known without walking the tree. When a filter is active the tree shows only
 * the folders that hold a matching note; the other ones stay open in the
 * state, which is harmless — they are not in the tree.
 *
 * Opening a note expands the folders on the way to it again, so a note that is
 * opened after this action is always visible.
 */
export function expandAllFolders(): void {
  update((prev) => ({
    ...prev,
    ui: { ...prev.ui, expanded: new Set(prev.tree.folders.map((folder) => folder.path)) },
  }));
  persistPrefs();
}

/** Closes every folder of the storage at once. */
export function collapseAllFolders(): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, expanded: new Set<string>() } }));
  persistPrefs();
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
    conflict: null,
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

/**
 * Closes the open note.
 *
 * The note is not deleted: the tree keeps it, and the editor becomes empty.
 * This is what the closing of the last tab does — a closed tab must not leave
 * the note on the screen.
 *
 * The pending changes reach the disk before the note leaves the screen: the
 * autosave is flushed, like it is flushed when another note is opened.
 */
export async function closeNote(): Promise<void> {
  const path = refs.currentPath;
  if (!path) return;
  if (autosave.dirty()) {
    await autosave.flush();
    // The note may have changed while the save was running.
    if (refs.currentPath !== path) return;
  }
  autosave.cancel();
  autosave.setActivePath(null);
  refs.currentPath = null;
  refs.content = '';
  refs.loadingPath = null;
  patchNote({
    path: null,
    content: '',
    contentPath: null,
    status: 'idle',
    saveError: null,
    dirty: false,
    conflict: null,
  });
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

/**
 * Takes the version of the server of the open note.
 *
 * The text of the editor becomes the text of the server and the revision of
 * the server is adopted, so the next save continues from there.
 */
export function takeServerVersion(): void {
  const conflict = getSnapshot().note.conflict;
  if (!conflict) return;
  refs.revision = conflict.serverRevision;
  refs.content = conflict.serverContent;
  patchNote({
    content: conflict.serverContent,
    revision: conflict.serverRevision,
    dirty: false,
    status: 'idle',
    saveError: null,
    conflict: null,
  });
  autosave.markClean();
}

/**
 * Writes the version of the editor over the version of the server.
 *
 * The write is forced (the revision `0`): the user has just decided that
 * their version wins, so the server must not refuse it.
 */
export async function keepLocalVersion(): Promise<void> {
  const conflict = getSnapshot().note.conflict;
  const path = refs.currentPath;
  if (!conflict || !path) return;
  const content = refs.content;
  try {
    const res = await getVaultService().saveNote(path, content, 0);
    refs.revision = res.revision;
    patchNote({
      revision: res.revision,
      dirty: false,
      status: 'saved',
      saveError: null,
      conflict: null,
    });
    await dropDraft(path).catch(() => undefined);
  } catch (err) {
    patchNote({
      status: 'error',
      saveError: err instanceof ApiError ? err.message : errorMessage(err),
    });
  }
}

/** Closes the conflict without changing the note. */
export function dismissConflict(): void {
  patchNote({ conflict: null, status: 'idle' });
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
 * Reads a day of the calendar (`YYYY-MM-DD`) as a local date.
 *
 * `new Date('2026-10-24')` is the midnight in the time zone of UTC, which in
 * a negative offset is the evening of the day before: the note of the "24th"
 * would be written with the name of the "23rd". The parts are therefore read
 * one by one, so the date is always the local one.
 */
export function localDateOf(day: string): Date {
  const parts = day.split('-').map((part) => Number.parseInt(part, 10));
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const dayOfMonth = parts[2] ?? 1;
  return new Date(year, month - 1, dayOfMonth);
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
  // A name is not optional: an empty name would create a note without a name
  // and a folder without a name. The dialog stays open and shows the reason.
  if (asksForName(kind) && !value.trim()) {
    showBanner('The name must not be empty.');
    return;
  }
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

/** Opens or closes the window of the search and the filters. */
export function setFindOpen(open: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, findOpen: open } }));
}

/** Switches the module of the window of the search. */
export function setFindMode(mode: FindMode): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, findMode: mode } }));
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

/**
 * Opens or closes the drawer of the column of the notes.
 *
 * On a narrow screen the column is a drawer over the editor. The rail of the
 * sections stays where it is, so the section the user chose has to come with
 * the drawer: otherwise the click on the rail would change nothing visible.
 */
export function setDrawerOpen(open: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, drawerOpen: open } }));
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

/**
 * Opens a section of the left column.
 *
 * The rail is an accordion: the column shows the section that is chosen here,
 * and the choice is remembered for the next start of the application.
 */
export function setRailSection(section: RailSection): void {
  if (getSnapshot().ui.railSection === section) return;
  update((prev) => ({ ...prev, ui: { ...prev.ui, railSection: section } }));
  persistPrefs();
}

/**
 * Shows another month in the calendar.
 *
 * The empty string means "the month of today": the section of the calendar
 * shows it when the user never chose a month.
 */
export function setCalendarMonth(month: string): void {
  if (getSnapshot().ui.calendarMonth === month) return;
  update((prev) => ({ ...prev, ui: { ...prev.ui, calendarMonth: month } }));
}

/**
 * Selects a day of the calendar.
 *
 * The day is the key of a date (`YYYY-MM-DD`); `null` means that no day is
 * selected.
 */
export function setCalendarDay(day: string | null): void {
  if (getSnapshot().ui.calendarDay === day) return;
  update((prev) => ({ ...prev, ui: { ...prev.ui, calendarDay: day } }));
}

/**
 * Tells the user something.
 *
 * The notification is created unread and is put at the head of the list: the
 * newest event is the one the user must see first.
 */
export function notify(input: NotificationInput): void {
  const notification = createNotification(input);
  update((prev) => ({
    ...prev,
    ui: { ...prev.ui, notifications: pushToList(prev.ui.notifications, notification) },
  }));
}

/** Marks one notification as read. */
export function markNotificationRead(id: string): void {
  update((prev) => ({
    ...prev,
    ui: { ...prev.ui, notifications: markInList(prev.ui.notifications, id) },
  }));
}

/** Marks every notification as read. */
export function markAllNotificationsRead(): void {
  update((prev) => ({
    ...prev,
    ui: { ...prev.ui, notifications: markAllInList(prev.ui.notifications) },
  }));
}

/** Removes one notification from the list. */
export function dismissNotification(id: string): void {
  update((prev) => ({
    ...prev,
    ui: { ...prev.ui, notifications: dismissFromList(prev.ui.notifications, id) },
  }));
}

/** Removes every notification from the list. */
export function clearNotifications(): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, notifications: clearNotificationList() } }));
}

/**
 * Marks a note as a favorite, or removes the mark.
 *
 * The list is written to `localStorage` at once: a favorite must survive a
 * reload of the page.
 */
export function toggleFavorite(path: string): void {
  const favorites = toggleInFavorites(getSnapshot().ui.favorites, path);
  saveFavorites(favorites);
  update((prev) => ({ ...prev, ui: { ...prev.ui, favorites } }));
}

/**
 * Adds a reminder.
 *
 * The list is written to `localStorage` at once: a reminder must survive a
 * reload of the page.
 */
export function addReminder(reminder: Reminder): void {
  const reminders = addToReminders(getSnapshot().ui.reminders, reminder);
  saveReminders(reminders);
  update((prev) => ({ ...prev, ui: { ...prev.ui, reminders } }));
}

/** Removes a reminder. */
export function removeReminder(id: string): void {
  const reminders = removeFromReminders(getSnapshot().ui.reminders, id);
  saveReminders(reminders);
  update((prev) => ({ ...prev, ui: { ...prev.ui, reminders } }));
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

  // The service of the query language is loaded on demand: the parser of the
  // query language is a heavy module, and the application has no use for it
  // before the user asks a question.
  const { getQueryService } = await import('../query/service');
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
    const { getQueryService } = await import('../query/service');
    const tags = await getQueryService().loadTags();
    update((prev) => ({ ...prev, ui: { ...prev.ui, tags } }));
  } catch (err) {
    reportError(err);
  }
}

/**
 * Refreshes the tags of the vault after a save.
 *
 * The tags are a cache of the text of the notes: a note that got a new tag
 * changes the list of the tags of the vault, so the chips of the block of the
 * selection must follow. The refresh is delayed, so a burst of saves does not
 * become a burst of requests.
 */
let tagsRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleTagsRefresh(): void {
  if (tagsRefreshTimer !== null) clearTimeout(tagsRefreshTimer);
  tagsRefreshTimer = setTimeout(() => {
    tagsRefreshTimer = null;
    void loadTags();
  }, 1500);
}

/* ----------------------------------------------------------------- vault */

/**
 * Remembers the state of the storage that is open now.
 *
 * The state of a storage lives in the registry (`../storages/storageRegistry`):
 * the storage that the user leaves keeps its tree, its note and its folders,
 * and the user finds them again when he comes back.
 */
function captureActiveStorage(): void {
  const state = getSnapshot();
  const path = state.ui.vaultPath;
  if (!path) return;
  storageRegistry.set(path, captureStorageState(state, { ...refs }, path));
}

/**
 * The paths of the storages that are open, the active one first.
 *
 * The path of the active storage comes first even when it was opened first:
 * the list is read as "the storage that is open now, and the others".
 */
function openStoragePaths(active: string): string[] {
  const rest = storageRegistry.paths().filter((path) => storageKey(path) !== storageKey(active));
  return active ? [active, ...rest] : rest;
}

/**
 * Puts the state of a storage back into the state of the store.
 *
 * The mirrors of the store go with it: a callback of the old storage must
 * not see the note of the new one. The text of the note of an encrypted
 * storage is not restored: the storage is locked after the switch, and the
 * text is read again when the user unlocks it.
 */
function restoreStorage(storage: StorageState): void {
  const sealed = getVaultService().mode === 'sealed';
  const note = sealed
    ? { ...storage.note, content: '', contentPath: null, dirty: false }
    : storage.note;
  update((prev) => applyStorageState(prev, { ...storage, note }));
  refs.currentPath = sealed ? null : storage.mirrors.currentPath;
  refs.content = sealed ? '' : storage.mirrors.content;
  refs.revision = note.revision;
  refs.loadingPath = null;
}

/** Reads the state of the storage of the notes. */
export async function loadVault(): Promise<void> {
  try {
    const info = await getVault();
    const path = info.path ?? '';
    update((prev) => ({
      ...prev,
      ui: {
        ...prev.ui,
        vaultConfigured: info.configured,
        vaultPath: path,
        vaultFixed: info.fixed === true,
        openStorages: path ? [path] : [],
      },
    }));
    // The storage of the server is open: it is registered, so the switch away
    // from it keeps its state.
    if (path) {
      storageRegistry.set(path, captureStorageState(getSnapshot(), { ...refs }, path));
    }
  } catch (err) {
    reportError(err);
  }
}

/**
 * Opens another storage of the notes.
 *
 * The server switches to the new folder. The storage that is open now keeps
 * its tree, its note and its folders, and the storage that is opened comes
 * back with the state it had when the user left it — if it was opened before.
 * A storage that was never opened is read from the server.
 */
export async function switchStorage(path: string): Promise<void> {
  const target = path.trim();
  if (!target) return;
  // The storage that is open is already open: there is nothing to switch.
  if (storageKey(target) === storageKey(getSnapshot().ui.vaultPath)) return;
  await openStorage(target);
}

/**
 * Opens a storage of the notes on the server.
 *
 * The action is the heart of the switch: the server is asked for the new
 * folder, the state of the storage we leave is remembered, and the state of
 * the storage we come to is put back.
 */
async function openStorage(target: string): Promise<void> {
  update((prev) => ({ ...prev, ui: { ...prev.ui, vaultBusy: true } }));
  try {
    const info = await setVault(target);
    const chosen = info.path ?? target;
    // The state of the storage we leave is remembered before the new one
    // takes its place.
    captureActiveStorage();
    await lockVault();
    await detectVaultMode();

    // The storage that is open now is read again: the user asked for it.
    const same = storageKey(chosen) === storageKey(getSnapshot().ui.vaultPath);
    const known = same ? undefined : storageRegistry.get(chosen);
    const storage = known ?? emptyStorageState(chosen);
    storageRegistry.set(chosen, storage);

    update((prev) => {
      const next = applyStorageState(prev, storage);
      return {
        ...next,
        ui: {
          ...next.ui,
          vaultConfigured: true,
          vaultPath: chosen,
          vaultBusy: false,
          // The server accepted the change: the storage is not fixed any more.
          vaultFixed: false,
          vaultRecents: pushVaultRecent(next.ui.vaultRecents, chosen),
          openStorages: openStoragePaths(chosen),
        },
      };
    });
    restoreStorage(storage);
    persistPrefs();
    // A storage that was opened before keeps the tree it had: the switch does
    // not read the server again. A new storage is read from the server.
    if (!known) await refreshTree();
  } catch (err) {
    update((prev) => ({ ...prev, ui: { ...prev.ui, vaultBusy: false } }));
    // A fixed storage is a normal state of the environment, not a failure.
    if (err instanceof ApiError && err.code === 'vault_fixed') {
      update((prev) => ({ ...prev, ui: { ...prev.ui, vaultFixed: true } }));
      showBanner(STORAGE_FIXED_MESSAGE);
      return;
    }
    reportError(err);
    throw err;
  }
}

/**
 * Chooses the folder with the notes.
 *
 * The action is the way into a storage: the server is always asked, even when
 * the folder is the one that is open already, and a storage that was open
 * before comes back with the state it had.
 */
export async function chooseVault(path: string): Promise<void> {
  const target = path.trim();
  if (!target) return;
  await openStorage(target);
}

/**
 * Closes a storage of the notes.
 *
 * A closed storage loses its state: its tree, its note and its folders are
 * gone, and opening it again starts from nothing.
 */
export function closeStorage(path: string): void {
  const target = path.trim();
  if (!target) return;
  const state = getSnapshot();
  const active = storageKey(target) === storageKey(state.ui.vaultPath);
  storageRegistry.close(target);
  if (active) {
    // The storage that is open is closed: the interface shows nothing of it.
    update((prev) => {
      const next = applyStorageState(prev, emptyStorageState(target));
      return { ...next, ui: { ...next.ui, openStorages: openStoragePaths('') } };
    });
    refs.currentPath = null;
    refs.content = '';
    refs.revision = 0;
    refs.loadingPath = null;
  } else {
    update((prev) => ({
      ...prev,
      ui: { ...prev.ui, openStorages: openStoragePaths(prev.ui.vaultPath) },
    }));
  }
  persistPrefs();
}

/**
 * Explains that the storage is fixed by the environment.
 *
 * The button of the storage stays where it is, but it cannot open anything:
 * the interface says why instead of pretending that the storage can be
 * changed.
 */
export function explainFixedStorage(): void {
  const { message, reason } = storageFixedExplanation();
  showBanner(`${message} ${reason}`);
}

/**
 * Chooses the folder with the notes.
 *
 * The server switches to the new folder; the tree of the notes is read again,
 * so the interface shows the notes of the new storage at once.
 */

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

/** Opens or closes the quick menu of the storage of the notes. */
export function setVaultMenuOpen(open: boolean): void {
  update((prev) => ({ ...prev, ui: { ...prev.ui, vaultMenuOpen: open } }));
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
 * Publishes the number of the writes that wait for the connection.
 *
 * The queue of the writes lives in the core (`../sync/offlineQueue.ts`); it
 * tells the store how many writes wait, and the interface shows it.
 */
export function setPendingSync(pending: number): void {
  publishPendingSync(pending);
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
  takeServerVersion(): void;
  keepLocalVersion(): Promise<void>;
  dismissConflict(): void;
  toggleFolder(path: string): void;
  expandAllFolders(): void;
  collapseAllFolders(): void;
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
  setFindOpen(open: boolean): void;
  setFindMode(mode: FindMode): void;
  closeNote(): Promise<void>;
  setPaletteOpen(open: boolean): void;
  togglePalette(): void;
  toggleDrawer(): void;
  closeDrawer(): void;
  setDrawerOpen(open: boolean): void;
  toggleTheme(): void;
  setTheme(theme: ThemePreference): void;
  setEffectiveTheme(theme: 'light' | 'dark'): void;
  applyTheme(theme: ThemePreference): void;
  expandFolder(path: string): void;
  setRailSection(section: RailSection): void;
  setVaultMenuOpen(open: boolean): void;
  setCalendarMonth(month: string): void;
  setCalendarDay(day: string | null): void;
  notify(input: NotificationInput): void;
  markNotificationRead(id: string): void;
  markAllNotificationsRead(): void;
  dismissNotification(id: string): void;
  clearNotifications(): void;
  toggleFavorite(path: string): void;
  addReminder(reminder: Reminder): void;
  removeReminder(id: string): void;
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
  /** Opens another storage and keeps the state of the storages apart. */
  switchStorage(path: string): Promise<void>;
  /** Closes a storage: it loses its tree, its note and its folders. */
  closeStorage(path: string): void;
  /** Explains that the storage is fixed by the environment. */
  explainFixedStorage(): void;
  duplicateNote(path: string): Promise<void>;
  addRecent(path: string): void;
  removeRecent(path: string): void;
  showBanner(message: string): void;
  dismissBanner(): void;
  setConnection(connection: ConnectionState): void;
  /** Publishes the number of the writes that wait for the connection. */
  setPendingSync(pending: number): void;
}

export const actions: AppActions = {
  refreshTree,
  openNote,
  closeTab,
  editContent,
  explicitSave,
  takeServerVersion,
  keepLocalVersion,
  dismissConflict,
  toggleFolder,
  expandAllFolders,
  collapseAllFolders,
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
  setFindOpen,
  setFindMode,
  closeNote,
  setPaletteOpen,
  togglePalette,
  toggleDrawer,
  closeDrawer,
  setDrawerOpen,
  toggleTheme,
  setTheme,
  setEffectiveTheme,
  applyTheme,
  expandFolder,
  setRailSection,
  setVaultMenuOpen,
  setCalendarMonth,
  setCalendarDay,
  notify,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  clearNotifications,
  toggleFavorite,
  addReminder,
  removeReminder,
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
  switchStorage,
  closeStorage,
  explainFixedStorage,
  duplicateNote,
  addRecent,
  removeRecent,
  showBanner,
  dismissBanner,
  setConnection,
  setPendingSync,
};
