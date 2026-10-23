import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ApiError,
  createFile,
  createFolder,
  deleteNote,
  getNote,
  getTree,
  moveNote,
  renameNote,
  saveNote,
} from './api/client';
import { AttachmentsPanel } from './components/AttachmentsPanel';
import { Dialog } from './components/Dialog';
import { MarkdownEditor, type EditorHandle } from './components/Editor';
import { Preview } from './components/Preview';
import { SearchPanel } from './components/SearchPanel';
import { Sidebar } from './components/Sidebar';
import { TrashPanel } from './components/TrashPanel';
import { TransferPanel } from './components/TransferPanel';
import { createAutosave, type AutosaveStatus } from './lib/autosave';
import { deleteDraft, getDraft, isDraftNewer, putDraft, type Draft } from './lib/drafts';
import { buildTree } from './lib/tree';
import { createWikiResolver } from './lib/wiki';
import { errorMessage } from './lib/utils';
import type { Node, NoteContent } from './types';

type ViewMode = 'editor' | 'split' | 'preview';

type DialogKind =
  | null
  | 'create-folder'
  | 'create-file'
  | 'rename'
  | 'move'
  | 'delete'
  | 'trash'
  | 'transfer'
  | 'attachments';

interface DialogState {
  kind: DialogKind;
  node?: Node;
  parentPath?: string;
  value?: string;
}

const AUTOSAVE_DELAY = 800;

export function App() {
  const [treeFolders, setTreeFolders] = useState<Node[]>([]);
  const [treeFiles, setTreeFiles] = useState<Node[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [contentPath, setContentPath] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<ViewMode>('split');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>({ kind: null });
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem('noto-theme') === 'light'
      ? 'light'
      : 'dark',
  );
  const [draftOffer, setDraftOffer] = useState<Draft | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const currentPathRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const contentRef = useRef('');
  /** Path of the note that is currently being loaded; edits are ignored then. */
  const loadingPathRef = useRef<string | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);

  currentPathRef.current = currentPath;
  revisionRef.current = revision;
  contentRef.current = content;

  const { roots, filesByParent } = useMemo(
    () => buildTree(treeFolders, treeFiles),
    [treeFolders, treeFiles],
  );

  const wikiResolver = useMemo(() => createWikiResolver(treeFiles), [treeFiles]);

  /* ------------------------------------------------------------- tree */

  const refreshTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const res = await getTree();
      setTreeFolders(res.folders ?? []);
      setTreeFiles(res.files ?? []);
    } catch (err) {
      setBanner(errorMessage(err));
    } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  /* ------------------------------------------------------------ saving */

  const saveNow = useCallback(async (path: string, text: string, rev: number) => {
    try {
      const res = await saveNote(path, text, rev);
      // Guard: never apply the response of an old note to the current one.
      if (currentPathRef.current !== path) return;
      revisionRef.current = res.revision;
      setRevision(res.revision);
      // Only drop the local draft when it still matches what was saved.
      if (contentRef.current === text) {
        await deleteDraft(path).catch(() => undefined);
      }
      // The new revision is handed back so the next save uses it.
      return res.revision;
    } catch (err) {
      if (currentPathRef.current !== path) return;
      const message = err instanceof ApiError ? err.message : errorMessage(err);
      setSaveError(message);
      // Keep the draft locally so that nothing is lost.
      await putDraft({ path, content: text, revision: rev, updatedAt: Date.now() }).catch(
        () => undefined,
      );
      throw err;
    }
  }, []);

  const autosave = useMemo(
    () =>
      createAutosave({
        delay: AUTOSAVE_DELAY,
        save: saveNow,
        onStatus: (next, error) => {
          setStatus(next);
          if (next === 'saved') {
            setDirty(false);
            setSaveError(null);
          } else if (next === 'error') {
            setSaveError(error ?? 'save failed');
          }
        },
      }),
    [saveNow],
  );

  useEffect(() => () => autosave.cancel(), [autosave]);

  const explicitSave = useCallback(() => {
    if (!currentPathRef.current) return;
    void autosave.flush();
  }, [autosave]);

  const onEditorChange = useCallback(
    (text: string) => {
      const path = currentPathRef.current;
      if (!path) return;
      // While the note is still loading its content is not editable.
      if (loadingPathRef.current === path) return;
      contentRef.current = text;
      setContent(text);
      setDirty(true);
      const draft: Draft = {
        path,
        content: text,
        revision: revisionRef.current,
        updatedAt: Date.now(),
      };
      void putDraft(draft).catch(() => undefined);
      autosave.markDirty(path, text, revisionRef.current);
    },
    [autosave],
  );

  /* ------------------------------------------------------- note opening */

  const openNote = useCallback(
    async (path: string) => {
      const previous = currentPathRef.current;
      if (previous && previous !== path && autosave.dirty()) {
        // Flush pending edits of the previous note before switching.
        await autosave.flush();
      }
      autosave.cancel();
      autosave.setActivePath(path);

      // Reset the editor content before the note is loaded, so the text of the
      // previous note is never shown (or edited) while the new one loads.
      contentRef.current = '';
      setContent('');
      setContentPath(null);
      setCurrentPath(path);
      currentPathRef.current = path;
      loadingPathRef.current = path;
      setDrawerOpen(false);
      setStatus('idle');
      setSaveError(null);
      setDirty(false);
      setDraftOffer(null);

      try {
        const note: NoteContent = await getNote(path);
        if (currentPathRef.current !== path) return;
        loadingPathRef.current = null;
        const draft = await getDraft(path).catch(() => undefined);
        revisionRef.current = note.revision;
        contentRef.current = note.content;
        setRevision(note.revision);
        setContent(note.content);
        setContentPath(path);
        autosave.markClean();
        if (draft && isDraftNewer(draft, note.updatedAt, note.content)) {
          // The local draft is newer: offer it, but never apply it silently.
          setDraftOffer(draft);
          return;
        }
        if (draft && draft.content === note.content) {
          await deleteDraft(path).catch(() => undefined);
        }
        setExpanded((prev) => {
          const next = new Set(prev);
          const parts = path.split('/');
          for (let i = 1; i < parts.length; i += 1) {
            next.add(parts.slice(0, i).join('/'));
          }
          return next;
        });
      } catch (err) {
        loadingPathRef.current = null;
        setStatus('error');
        setSaveError(errorMessage(err));
      }
    },
    [autosave],
  );

  const restoreDraft = useCallback(() => {
    const draft = draftOffer;
    setDraftOffer(null);
    if (!draft) return;
    contentRef.current = draft.content;
    setContent(draft.content);
    setContentPath(draft.path);
    setDirty(true);
    autosave.setActivePath(draft.path);
    autosave.markDirty(draft.path, draft.content, revisionRef.current);
  }, [autosave, draftOffer]);

  const discardDraft = useCallback(() => {
    const draft = draftOffer;
    setDraftOffer(null);
    if (!draft) return;
    void deleteDraft(draft.path).catch(() => undefined);
  }, [draftOffer]);

  /* ----------------------------------------------------- tree operations */

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const closeDialog = () => setDialog({ kind: null });

  const runFolderCreate = async (parentPath: string, name: string) => {
    await createFolder(parentPath, name);
    await refreshTree();
  };

  const runFileCreate = async (parentPath: string, name: string) => {
    const node = await createFile(parentPath, name);
    await refreshTree();
    if (node?.path) await openNote(node.path);
  };

  const runRename = async (node: Node, newName: string) => {
    const renamed = await renameNote(node.path, newName);
    await refreshTree();
    if (currentPathRef.current === node.path && renamed?.path) {
      setCurrentPath(renamed.path);
      currentPathRef.current = renamed.path;
      autosave.setActivePath(renamed.path);
    }
  };

  const runMove = async (node: Node, newParentPath: string) => {
    const moved = await moveNote(node.path, newParentPath);
    await refreshTree();
    if (currentPathRef.current === node.path && moved?.path) {
      setCurrentPath(moved.path);
      currentPathRef.current = moved.path;
      autosave.setActivePath(moved.path);
    }
  };

  const runDelete = async (node: Node) => {
    await deleteNote(node.path);
    await refreshTree();
    if (currentPathRef.current === node.path) {
      setCurrentPath(null);
      currentPathRef.current = null;
      setContent('');
      contentRef.current = '';
      setContentPath(null);
      setStatus('idle');
      setSaveError(null);
      setDirty(false);
      autosave.setActivePath(null);
    }
  };

  const confirmDialog = async () => {
    const kind = dialog.kind;
    const node = dialog.node;
    const value = dialog.value ?? '';
    const parentPath = dialog.parentPath ?? '';
    closeDialog();
    try {
      if (kind === 'create-folder') await runFolderCreate(parentPath, value);
      else if (kind === 'create-file') await runFileCreate(parentPath, value);
      else if (kind === 'rename' && node) await runRename(node, value);
      else if (kind === 'move' && node) await runMove(node, value);
      else if (kind === 'delete' && node) await runDelete(node);
    } catch (err) {
      setBanner(errorMessage(err));
    }
  };

  /* --------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      const inEditor = Boolean((event.target as HTMLElement | null)?.closest?.('.cm-editor'));
      if (key === 'k' || key === 'p') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (key === 's' && !inEditor) {
        event.preventDefault();
        explicitSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [explicitSave]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('noto-theme', theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  // Keep the layout height in sync with the mobile keyboard viewport.
  useEffect(() => {
    const viewport = typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!viewport) return;
    const update = () => {
      document.documentElement.style.setProperty('--app-height', `${viewport.height}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  const insertAtCursor = (markdown: string) => {
    editorRef.current?.insert(markdown);
  };

  const treeFolderPaths = useMemo(
    () => treeFolders.map((f) => f.path).sort((a, b) => a.localeCompare(b)),
    [treeFolders],
  );

  const statusLabel =
    status === 'saving'
      ? 'Saving…'
      : status === 'saved'
        ? 'Saved'
        : status === 'error'
          ? 'Save failed'
          : dirty
            ? 'Unsaved changes'
            : currentPath
              ? 'Saved'
              : 'Idle';

  return (
    <div class={`app mode-${mode}${drawerOpen ? ' drawer-open' : ''}`}>
      <header class="app-header">
        <button
          type="button"
          class="icon-button menu-button"
          aria-label="Toggle navigation"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          ☰
        </button>
        <span class="app-title">{currentPath ? currentPath.split('/').pop() : 'Noto'}</span>
        <div class="app-header-actions">
          <span class={`status status-${status}`} data-testid="save-status" role="status">
            {statusLabel}
          </span>
          <div class="mode-switch" role="group" aria-label="View mode">
            {(['editor', 'split', 'preview'] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                class={mode === m ? 'active' : ''}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Toggle theme"
            title="Toggle theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☾' : '☀'}
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label="Attachments"
            title="Attachments"
            onClick={() => setDialog({ kind: 'attachments' })}
          >
            🖼
          </button>
        </div>
      </header>

      {!online ? (
        <div class="offline-banner" role="status" data-testid="offline-banner">
          Offline — changes are kept locally and will be retried.
        </div>
      ) : null}

      {banner ? (
        <div class="error-banner" role="alert">
          {banner}
          <button
            type="button"
            class="icon-button"
            aria-label="Dismiss"
            onClick={() => setBanner(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      <div class="app-body">
        {drawerOpen ? (
          <div class="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
        ) : null}        <div class="sidebar-wrap">
          <Sidebar
            folders={roots}
            filesByParent={filesByParent}
            currentPath={currentPath ?? ''}
            expanded={expanded}
            onToggle={toggleFolder}
            onSelect={(path) => void openNote(path)}
            onCreateFolder={(parentPath) =>
              setDialog({ kind: 'create-folder', parentPath, value: 'New folder' })
            }
            onCreateFile={(parentPath) =>
              setDialog({ kind: 'create-file', parentPath, value: 'note.md' })
            }
            onRename={(node) => setDialog({ kind: 'rename', node, value: node.name })}
            onMove={(node) => setDialog({ kind: 'move', node, value: node.parentPath })}
            onDelete={(node) => setDialog({ kind: 'delete', node })}
            onOpenTrash={() => setDialog({ kind: 'trash' })}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenTransfer={() => setDialog({ kind: 'transfer' })}
            onRefresh={() => void refreshTree()}
            loading={treeLoading}
          />
        </div>

        <main class="workspace">
          <div class="pane pane-editor">
            <MarkdownEditor
              value={content}
              path={currentPath ?? ''}
              contentPath={contentPath}
              onChange={onEditorChange}
              onSave={explicitSave}
              onHandle={(handle) => {
                editorRef.current = handle;
              }}
            />
            {!currentPath ? (
              <div class="empty-state" data-testid="empty-state">
                <h2>No note selected</h2>
                <p>Pick a note in the sidebar or create a new one.</p>
              </div>
            ) : null}
          </div>
          {mode === 'split' || mode === 'preview' ? (
            <div class={`pane pane-preview${mode === 'preview' ? ' only-preview' : ''}`}>
              <Preview
                source={content}
                resolve={wikiResolver}
                onOpenNote={(path) => void openNote(path)}
              />
            </div>
          ) : null}
        </main>
      </div>

      <footer class="app-footer">
        {saveError ? (
          <span class="error-text" role="alert">
            {saveError}
          </span>
        ) : null}
        {status === 'error' ? (
          <button type="button" class="text-button" onClick={explicitSave}>
            Retry save
          </button>
        ) : null}
        <span class="muted">{currentPath ?? ''}</span>
      </footer>

      <SearchPanel
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenNote={(path) => void openNote(path)}
      />

      <TrashPanel
        open={dialog.kind === 'trash'}
        onClose={closeDialog}
        onRestored={() => void refreshTree()}
      />

      <TransferPanel
        open={dialog.kind === 'transfer'}
        onClose={closeDialog}
        currentPath={currentPath}
        onImported={() => void refreshTree()}
      />

      <Dialog title="Attachments" open={dialog.kind === 'attachments'} onClose={closeDialog}>
        <AttachmentsPanel notePath={currentPath} onInsert={insertAtCursor} />
      </Dialog>

      <Dialog
        title={
          dialog.kind === 'create-folder'
            ? 'New folder'
            : dialog.kind === 'create-file'
              ? 'New note'
              : dialog.kind === 'rename'
                ? 'Rename'
                : dialog.kind === 'move'
                  ? 'Move'
                  : 'Delete'
        }
        open={
          dialog.kind === 'create-folder' ||
          dialog.kind === 'create-file' ||
          dialog.kind === 'rename' ||
          dialog.kind === 'move' ||
          dialog.kind === 'delete'
        }
        onClose={closeDialog}
        footer={
          <>
            <button type="button" class="text-button" onClick={closeDialog}>
              Cancel
            </button>
            <button type="button" class="primary-button" onClick={() => void confirmDialog()}>
              {dialog.kind === 'delete' ? 'Delete' : 'OK'}
            </button>
          </>
        }
      >
        {dialog.kind === 'move' ? (
          <label class="field">
            <span>Target folder</span>
            <select
              aria-label="Target folder"
              value={dialog.value ?? ''}
              onChange={(e) =>
                setDialog({ ...dialog, value: (e.target as HTMLSelectElement).value })
              }
            >
              <option value="">(root)</option>
              {treeFolderPaths.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </label>
        ) : dialog.kind === 'delete' ? (
          <p>
            Delete <strong>{dialog.node?.name}</strong>? It can be restored from the trash.
          </p>
        ) : (
          <label class="field">
            <span>Name</span>
            <input
              type="text"
              aria-label="Name"
              value={dialog.value ?? ''}
              onInput={(e) =>
                setDialog({ ...dialog, value: (e.target as HTMLInputElement).value })
              }
            />
          </label>
        )}
      </Dialog>

      <Dialog
        title="Recover local draft?"
        open={draftOffer !== null}
        onClose={closeDialog}
        footer={
          <>
            <button type="button" class="text-button" onClick={discardDraft}>
              Discard
            </button>
            <button type="button" class="primary-button" onClick={restoreDraft}>
              Restore
            </button>
          </>
        }
      >
        <p>
          A newer unsaved local version of <strong>{draftOffer?.path}</strong> exists. Restore it?
        </p>
      </Dialog>
    </div>
  );
}
