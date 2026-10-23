import { useEffect, useMemo, useRef } from 'preact/hooks';
import { AppFooter } from './components/AppFooter';
import { AppHeader } from './components/AppHeader';
import { AttachmentsPanel } from './components/AttachmentsPanel';
import { Dialog } from './components/Dialog';
import { MarkdownEditor, type EditorHandle } from './components/Editor';
import { NoteDialogs } from './components/NoteDialogs';
import { Preview } from './components/Preview';
import { SearchPanel } from './components/SearchPanel';
import { Sidebar } from './components/Sidebar';
import { TrashPanel } from './components/TrashPanel';
import { TransferPanel } from './components/TransferPanel';
import { appStore } from './core/store/appStore';
import { useAppActions, useAppState } from './core/store/hooks';
import { buildTree } from './lib/tree';
import { createWikiResolver } from './lib/wiki';

/**
 * The application shell.
 *
 * All state lives in the store (`./core/store/appStore.ts`); this component
 * only composes the UI and forwards user intents to the store actions.
 */
export function App() {
  const state = useAppState();
  const actions = useAppActions();
  const editorRef = useRef<EditorHandle | null>(null);

  const { tree, note, ui, env, dialog, draftOffer, banner } = state;

  useEffect(() => {
    appStore.start();
    return () => appStore.stop();
  }, []);

  /* --------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      const inEditor = Boolean((event.target as HTMLElement | null)?.closest?.('.cm-editor'));
      if (key === 'k' || key === 'p') {
        event.preventDefault();
        actions.setSearchOpen(true);
        return;
      }
      if (key === 's' && !inEditor) {
        event.preventDefault();
        actions.explicitSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);

  /* ----------------------------------------------------------- derived */

  const { roots, filesByParent } = useMemo(
    () => buildTree(tree.folders, tree.files),
    [tree.folders, tree.files],
  );

  const wikiResolver = useMemo(() => createWikiResolver(tree.files), [tree.files]);

  const treeFolderPaths = useMemo(
    () => tree.folders.map((f) => f.path).sort((a, b) => a.localeCompare(b)),
    [tree.folders],
  );

  const statusLabel =
    note.status === 'saving'
      ? 'Saving…'
      : note.status === 'saved'
        ? 'Saved'
        : note.status === 'error'
          ? 'Save failed'
          : note.dirty
            ? 'Unsaved changes'
            : note.path
              ? 'Saved'
              : 'Idle';

  const insertAtCursor = (markdown: string) => {
    editorRef.current?.insert(markdown);
  };

  return (
    <div class={`app mode-${ui.mode}${ui.drawerOpen ? ' drawer-open' : ''}`}>
      <AppHeader
        title={note.path ? note.path.split('/').pop()! : 'Noto'}
        status={note.status}
        statusLabel={statusLabel}
        mode={ui.mode}
        drawerOpen={ui.drawerOpen}
        theme={env.theme}
        onToggleDrawer={actions.toggleDrawer}
        onSetMode={actions.setMode}
        onToggleTheme={actions.toggleTheme}
        onOpenAttachments={() => actions.openDialog({ kind: 'attachments' })}
      />

      {!env.online ? (
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
            onClick={actions.dismissBanner}
          >
            ×
          </button>
        </div>
      ) : null}

      <div class="app-body">
        {ui.drawerOpen ? (
          <div class="drawer-backdrop" onClick={actions.closeDrawer} aria-hidden="true" />
        ) : null}        <div class="sidebar-wrap">
          <Sidebar
            folders={roots}
            filesByParent={filesByParent}
            currentPath={note.path ?? ''}
            expanded={ui.expanded}
            onToggle={actions.toggleFolder}
            onSelect={(path) => void actions.openNote(path)}
            onCreateFolder={(parentPath) =>
              actions.openDialog({ kind: 'create-folder', parentPath, value: 'New folder' })
            }
            onCreateFile={(parentPath) =>
              actions.openDialog({ kind: 'create-file', parentPath, value: 'note.md' })
            }
            onRename={(node) => actions.openDialog({ kind: 'rename', node, value: node.name })}
            onMove={(node) => actions.openDialog({ kind: 'move', node, value: node.parentPath })}
            onDelete={(node) => actions.openDialog({ kind: 'delete', node })}
            onOpenTrash={() => actions.openDialog({ kind: 'trash' })}
            onOpenSearch={() => actions.setSearchOpen(true)}
            onOpenTransfer={() => actions.openDialog({ kind: 'transfer' })}
            onRefresh={() => void actions.refreshTree()}
            loading={tree.loading}
          />
        </div>

        <main class="workspace">
          <div class="pane pane-editor">
            <MarkdownEditor
              value={note.content}
              path={note.path ?? ''}
              contentPath={note.contentPath}
              onChange={actions.editContent}
              onSave={actions.explicitSave}
              onHandle={(handle) => {
                editorRef.current = handle;
              }}
            />
            {!note.path ? (
              <div class="empty-state" data-testid="empty-state">
                <h2>No note selected</h2>
                <p>Pick a note in the sidebar or create a new one.</p>
              </div>
            ) : null}
          </div>
          {ui.mode === 'split' || ui.mode === 'preview' ? (
            <div class={`pane pane-preview${ui.mode === 'preview' ? ' only-preview' : ''}`}>
              <Preview
                source={note.content}
                resolve={wikiResolver}
                onOpenNote={(path) => void actions.openNote(path)}
              />
            </div>
          ) : null}
        </main>
      </div>

      <AppFooter
        saveError={note.saveError}
        status={note.status}
        currentPath={note.path ?? ''}
        onRetrySave={actions.explicitSave}
      />

      <SearchPanel
        open={ui.searchOpen}
        onClose={() => actions.setSearchOpen(false)}
        onOpenNote={(path) => void actions.openNote(path)}
      />

      <TrashPanel
        open={dialog.kind === 'trash'}
        onClose={actions.closeDialog}
        onRestored={() => void actions.refreshTree()}
      />

      <TransferPanel
        open={dialog.kind === 'transfer'}
        onClose={actions.closeDialog}
        currentPath={note.path}
        onImported={() => void actions.refreshTree()}
      />

      <Dialog title="Attachments" open={dialog.kind === 'attachments'} onClose={actions.closeDialog}>
        <AttachmentsPanel notePath={note.path} onInsert={insertAtCursor} />
      </Dialog>

      <NoteDialogs
        dialog={dialog}
        folderPaths={treeFolderPaths}
        draftOffer={draftOffer}
        onClose={actions.closeDialog}
        onConfirm={() => void actions.confirmDialog()}
        onChangeValue={actions.setDialogValue}
        onRestoreDraft={actions.restoreDraft}
        onDiscardDraft={actions.discardDraft}
      />
    </div>
  );
}
