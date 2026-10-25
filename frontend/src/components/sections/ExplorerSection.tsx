// The explorer section of the left column.
//
// The section shows the vault with its global actions and the tree of the
// notes. It is the section that is open by default: the notes are what the
// user came for.
//
// The tree of the notes lives here, and so does the state of the drag and drop
// between the folders: the two belong together and nothing else needs them.
import { useMemo, useRef, useState } from 'preact/hooks';
import type { Node } from '../../types';
import type { TreeFolder } from '../../lib/tree';
import type { MoveRefusal } from '../../lib/tree';
import { allFiles, allFolderNodes, filterTree, refusalOfMove } from '../../lib/tree';
import { useAppActions } from '../../core/store/hooks';
import { STORAGE_FIXED_MESSAGE } from '../../core/storages/fixedStorage';
import { pinnedNodes, usePins } from '../../core/pin/pins';
import { quickNoteName } from '../../core/quicknotes/quickNotes';
import { getVaultService } from '../../core/vault/vaultService';
import { useT } from '../../i18n/useT';
import { Icon } from '../../ui/icons';
import { IconButton } from '../../ui/tooltip';
import type { TreeContextMenuPayload } from '../TreeContextMenu';
import { TreeFolderRow, TreeNoteRow, type TreeDragState } from '../TreeRow';
import { VaultSwitchMenu } from '../VaultSwitchMenu';
import { ArchivePanel } from './ArchivePanel';
import { GraphPanel } from './GraphPanel';
import { QuickNotesSection } from './QuickNotesSection';

export interface ExplorerSectionProps {
  /** The folders of the vault. */
  folders: TreeFolder[];
  /** The notes of the vault, indexed by the path of their folder. */
  filesByParent: Map<string, Node[]>;
  /** The path of the note that is open in the editor. */
  currentPath: string;
  /** The paths of the folders that are open. */
  expanded: Set<string>;
  /** True while the tree is being loaded. */
  loading: boolean;
  /** Called when a folder is folded or unfolded. */
  onToggle(path: string): void;
  /** Called when every folder of the storage must be opened at once. */
  onExpandAll?(): void;
  /** Called when every folder of the storage must be closed at once. */
  onCollapseAll?(): void;
  /** Called when a note is chosen. */
  onSelect(path: string): void;
  /** Called when the user asks for a new folder. */
  onCreateFolder(parentPath: string): void;
  /** Called when the user asks for a new note. */
  onCreateFile(parentPath: string): void;
  /** Called when the user asks to rename a node. */
  onRename(node: Node): void;
  /** Called when the user asks to move a node. */
  onMove(node: Node): void;
  /** Called when the user asks to delete a node. */
  onDelete(node: Node): void;
  /** Called when the user asks for the menu of a row. */
  onContextMenu?: (payload: TreeContextMenuPayload) => void;
  /** Called when a row is renamed in place. */
  onRenameInline?: (node: Node, name: string) => void | Promise<void>;
  /** Called when a node is dropped on another folder. */
  onMoveNode?: (node: Node, targetParentPath: string) => void | Promise<void>;
  /** Called when the user asks for a fresh tree. */
  onRefresh(): void;
  /** The name of the vault. */
  vaultName?: string;
  /** The path of the vault on the disk. */
  vaultPath?: string;
  /** True when the storage is fixed by the environment and cannot be changed. */
  vaultFixed?: boolean;
  /** The storages that were opened before, the newest first. */
  vaultRecents?: string[];
  /** True when the quick menu of the storage is open. */
  vaultMenuOpen?: boolean;
  /** The mode of the storage of the notes. */
  vaultMode?: 'open' | 'sealed';
  /** True when the storage is encrypted and locked. */
  vaultLocked?: boolean;
  /**
   * Called when the user presses the lock of the storage.
   *
   * The action depends on the mode: an encrypted storage is locked, an open
   * one is offered the wizard of the encryption.
   */
  onVaultLock?(): void;
  /** Called when the user opens or closes the quick menu of the storage. */
  onVaultMenuToggle?(open: boolean): void;
  /** Called when the user chooses a storage from the menu. */
  onSwitchVault?(path: string): void;
  /** Called when the user asks for the dialog of the choice of the storage. */
  onChooseVault?: () => void;
  /** False when the counters of the tree are hidden. */
  showCounts?: boolean;
  /**
   * The paths of the notes that match the filter of the user.
   *
   * `null` means "no filter": the tree shows every note. A set of paths
   * filters the tree: only the matching notes and the folders that hold them
   * stay visible.
   */
  filterPaths?: Set<string> | null;
  /**
   * Opens the graph of the vault.
   *
   * When the shell does not answer, the explorer opens the graph by itself.
   */
  onOpenGraph?(): void;
  /**
   * Opens the archive of the vault.
   *
   * When the shell does not answer, the explorer opens the archive by itself.
   */
  onOpenArchive?(): void;
  /** Opens the command palette of the application. */
  onOpenPalette?(): void;
  /** Opens the manager of the plugins. */
  onOpenPlugins?(): void;
}

export function ExplorerSection(props: ExplorerSectionProps) {
  const t = useT();
  const [drag, setDrag] = useState<TreeDragState>({ path: null, isFolder: false });
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [rootOver, setRootOver] = useState(false);
  /**
   * The panel that stands in the place of the tree.
   *
   * The graph and the archive are opened from the header of the explorer. When
   * the shell does not answer, the explorer opens them by itself.
   */
  const [panel, setPanel] = useState<'graph' | 'archive' | null>(null);
  const actions = useAppActions();
  const pins = usePins();
  /**
   * The answer of the current drag.
   *
   * `dropHandled` says that the drag ended with a drop that the explorer
   * knows. `dragRefusal` says why the target under the pointer would refuse
   * the move (or that the pointer was over no target at all). Both are reset
   * when the next drag starts.
   */
  const dropHandled = useRef(false);
  const dragRefusal = useRef<MoveRefusal | 'nowhere' | null>(null);
  /**
   * The buttons that open the quick menu of the storage.
   *
   * The menu closes itself when the user clicks outside of it. The buttons that
   * open it must not be seen as "outside", otherwise the click would close the
   * menu and open it again.
   */
  const triggerRef = useRef<HTMLSpanElement | null>(null);

  /** Opens or closes the quick menu of the storage. */
  const toggleMenu = (): void => {
    if (props.vaultFixed) return;
    props.onVaultMenuToggle?.(!props.vaultMenuOpen);
  };

  /**
   * The action of the lock of the storage.
   *
   * An encrypted storage has a key that can be forgotten; an open storage has
   * none, so the same slot offers the wizard of the encryption instead.
   */
  const lockLabel =
    props.vaultMode === 'sealed'
      ? props.vaultLocked
        ? t('explorer.unlockVault')
        : t('explorer.lockVault')
      : t('explorer.setupEncrypted');
  const lockIcon = props.vaultMode === 'sealed' && props.vaultLocked ? 'lock-open' : 'lock';
  /**
   * The tree of the notes, filtered by the query of the user.
   *
   * The filter is a view of the tree, not of the storage: the notes that do
   * not match stay in the vault and stay reachable through the tabs.
   */
  const view = useMemo(() => {
    if (!props.filterPaths) {
      return { folders: props.folders, filesByParent: props.filesByParent };
    }
    return filterTree(props.folders, props.filesByParent, props.filterPaths);
  }, [props.folders, props.filesByParent, props.filterPaths]);

  const rootFiles = view.filesByParent.get('') ?? [];
  const isEmpty = view.folders.length === 0 && rootFiles.length === 0;
  const filtered = props.filterPaths !== null && props.filterPaths !== undefined;

  // Every node of the tree, indexed by its path: the menu needs the node of
  // the path it was opened on, and a drop needs the node that is dragged.
  const nodesByPath = useMemo(() => {
    const map = new Map<string, Node>();
    const walk = (folders: TreeFolder[]): void => {
      for (const folder of folders) {
        map.set(folder.node.path, folder.node);
        walk(folder.children);
      }
    };
    walk(props.folders);
    for (const files of props.filesByParent.values()) {
      for (const file of files) map.set(file.path, file);
    }
    return map;
  }, [props.folders, props.filesByParent]);

  /**
   * The number of the notes of every folder.
   *
   * The counter is counted by the server (recursively, so a folder shows the
   * notes of its subfolders as well) and only travels with the tree.
   */
  const noteCountsByPath = useMemo(() => {
    const map = new Map<string, number>();
    if (props.showCounts === false) return map;
    const walk = (folders: TreeFolder[]): void => {
      for (const folder of folders) {
        const count = folder.node.noteCount;
        if (typeof count === 'number') map.set(folder.node.path, count);
        walk(folder.children);
      }
    };
    walk(props.folders);
    return map;
  }, [props.folders, props.showCounts]);

  /**
   * The notes of the whole vault, whatever the folder they live in.
   *
   * The graph, the archive and the quick notes are views of the vault, not of
   * the part of it that the filter of the user left visible.
   */
  const vaultFiles = useMemo(() => allFiles(props.filesByParent), [props.filesByParent]);
  const vaultFolders = useMemo(() => allFolderNodes(props.folders), [props.folders]);

  /** The notes the user pinned to the top of the tree. */
  const pinnedFiles = useMemo(() => pinnedNodes(vaultFiles, pins), [vaultFiles, pins]);

  /**
   * Opens the graph of the vault.
   *
   * The shell may want to open the graph in its own window; when it does not
   * answer, the explorer opens the panel by itself.
   */
  const openGraph = (): void => {
    if (props.onOpenGraph) {
      props.onOpenGraph();
      return;
    }
    setPanel('graph');
  };

  /** Opens the archive of the vault. */
  const openArchive = (): void => {
    if (props.onOpenArchive) {
      props.onOpenArchive();
      return;
    }
    setPanel('archive');
  };

  /**
   * Creates a quick note: a note without a name and without a folder.
   *
   * The note is created at the root of the vault and opened right away: the
   * user writes first and names the note later.
   */
  const createQuickNote = async (): Promise<void> => {
    const taken = vaultFiles.filter((file) => !file.parentPath).map((file) => file.name);
    const name = quickNoteName(taken);
    try {
      const node = await getVaultService().createFile('', name);
      await actions.refreshTree();
      await actions.openNote(node.path);
    } catch {
      // The store shows the failure in its banner.
    }
  };

  /**
   * The message of a refusal.
   *
   * Every drag ends with an answer: either the node moved, or the user is
   * told why it did not. A drag that ends nowhere is the case that used to
   * be silent.
   */
  const messageOfRefusal = (refusal: MoveRefusal, node: Node | undefined): string => {
    if (refusal === 'into-itself') return t('explorer.moveIntoItself');
    if (refusal === 'already-there') {
      return node?.type === 'folder' ? t('explorer.folderAlreadyThere') : t('explorer.noteAlreadyThere');
    }
    return t('explorer.notMoved');
  };

  /** The start of a drag: the answer of the previous one is forgotten. */
  const startDrag = (state: TreeDragState): void => {
    dropHandled.current = false;
    dragRefusal.current = null;
    setDrag(state);
  };

  /**
   * The end of a drag: every highlight disappears.
   *
   * A drag that ended without a drop is answered: the user is told that the
   * node stayed where it was, and why.
   */
  const endDrag = (): void => {
    const path = drag.path;
    const node = path ? nodesByPath.get(path) : undefined;
    const refusal = dragRefusal.current;
    const handled = dropHandled.current;
    setDrag({ path: null, isFolder: false });
    setDropHint(null);
    setRootOver(false);
    if (handled || refusal === null) return;
    setDropHint(refusal === 'nowhere' ? t('explorer.notMoved') : messageOfRefusal(refusal, node));
  };

  /**
   * A node is dropped on a folder.
   *
   * The invalid drops are refused here, so the rows stay simple: a folder
   * cannot be moved into itself or into one of its own descendants, and a
   * node cannot be moved into the folder it already lives in. The rule is the
   * one of `lib/tree`: the row of the tree and the explorer cannot disagree.
   */
  const dropOn = (targetParentPath: string): void => {
    const path = drag.path;
    const node = path ? nodesByPath.get(path) : undefined;
    // The drop is answered: the end of the drag must not complain about a
    // move that did happen.
    dropHandled.current = true;
    const refusal = node ? refusalOfMove(node, targetParentPath) : null;
    endDrag();
    if (!node) return;

    if (refusal) {
      setDropHint(messageOfRefusal(refusal, node));
      return;
    }
    setDropHint(null);
    void props.onMoveNode?.(node, targetParentPath);
  };

  /** The node that is dragged, if any: the rows need its kind, not only its path. */
  const draggingNode = drag.path ? (nodesByPath.get(drag.path) ?? null) : null;

  return (
    <section class="column-section" aria-label={t('section.explorer')}>
      <header class="column-header vault-header">
        <span class="vault-header-icon">
          <Icon name="folder" size={15} />
        </span>
        <span class="vault-header-name">{props.vaultName ?? 'Noto'}</span>
        <span class="vault-header-triggers" ref={triggerRef}>
          {props.onChooseVault ? (
            <button
              type="button"
              class="vault-header-path"
              title={
                props.vaultFixed
                  ? t('explorer.storageFixed')
                  : props.vaultPath
              }
              aria-label={t('explorer.changeStorage')}
              aria-disabled={props.vaultFixed ? 'true' : undefined}
              aria-haspopup="menu"
              aria-expanded={props.vaultMenuOpen ? 'true' : undefined}
              onClick={toggleMenu}
            >
              {props.vaultPath || t('explorer.chooseFolder')}
            </button>
          ) : (
            <span class="vault-header-path" title={props.vaultPath}>
              {props.vaultPath}
            </span>
          )}
        </span>
        <button
          type="button"
          class="icon-button"
          title={lockLabel}
          aria-label={lockLabel}
          onClick={() => props.onVaultLock?.()}
        >
          <Icon name={lockIcon} size={15} />
        </button>
        <button
          type="button"
          class="icon-button"
          title={t('tree.newNote')}
          aria-label={t('tree.newNote')}
          onClick={() => props.onCreateFile('')}
        >
          <Icon name="file-plus" size={15} />
        </button>
        <button
          type="button"
          class="icon-button"
          title={t('tree.newFolder')}
          aria-label={t('tree.newFolder')}
          onClick={() => props.onCreateFolder('')}
        >
          <Icon name="folder-plus" size={15} />
        </button>
        <button
          type="button"
          class="icon-button"
          title={t('explorer.refresh')}
          aria-label={t('explorer.refreshTree')}
          onClick={props.onRefresh}
        >
          <Icon name="refresh-cw" size={15} />
        </button>
        {props.vaultMenuOpen ? (
          <VaultSwitchMenu
            currentPath={props.vaultPath ?? ''}
            recents={props.vaultRecents ?? []}
            fixed={props.vaultFixed}
            triggerRef={triggerRef}
            onSwitch={(path) => props.onSwitchVault?.(path)}
            onBrowse={() => props.onChooseVault?.()}
            onClose={() => props.onVaultMenuToggle?.(false)}
          />
        ) : null}
      </header>

      <div class="column-body">
        {/*
          The storage of the notes can be fixed by the environment. The button
          of the storage stays where it is, but it cannot open anything: the
          column says why instead of pretending that the storage can be
          changed. The note stands under the header of the column — a message
          above it would push the headers of the columns down.
        */}
        {props.vaultFixed ? (
          <p class="storage-fixed-note" role="note" data-testid="storage-fixed-note">
            <span class="storage-fixed-message">{STORAGE_FIXED_MESSAGE}</span>
            <button
              type="button"
              class="text-button"
              onClick={() => actions.explainFixedStorage()}
            >
              {t('sidebar.whyFixed')}
            </button>
          </p>
        ) : null}
        <div class="sidebar-section">
          <div class="sidebar-section-title">
            <span>
              {t('section.explorer')}
              {filtered ? (
                <span class="q9-filtered-badge">{t('explorer.filtered')}</span>
              ) : null}
            </span>
            <div class="sidebar-section-actions" role="group" aria-label={t('explorer.actions')}>
              <IconButton
                label={t('explorer.expandAll')}
                icon="chevrons-down-up"
                onClick={() => props.onExpandAll?.()}
              />
              <IconButton
                label={t('explorer.collapseAll')}
                icon="chevrons-up-down"
                onClick={() => props.onCollapseAll?.()}
              />
              <IconButton
                label={t('explorer.graph')}
                icon="network"
                title={t('explorer.graph')}
                onClick={openGraph}
              />
              <IconButton
                label={t('explorer.archive')}
                icon="archive"
                title={t('explorer.archive')}
                onClick={openArchive}
              />
              <IconButton
                label={t('explorer.palette')}
                icon="command"
                title={t('explorer.paletteTitle')}
                onClick={() => props.onOpenPalette?.()}
              />
              <IconButton label={t('explorer.plugins')} icon="puzzle" onClick={() => props.onOpenPlugins?.()} />
            </div>
          </div>

          {panel === 'graph' ? (
            <GraphPanel
              files={vaultFiles}
              onOpenNote={props.onSelect}
              onClose={() => setPanel(null)}
            />
          ) : null}

          {panel === 'archive' ? (
            <ArchivePanel
              files={vaultFiles}
              folders={vaultFolders}
              onOpenNote={props.onSelect}
              onRename={props.onRename}
              onDelete={props.onDelete}
              onClose={() => setPanel(null)}
            />
          ) : null}

          {panel ? null : (
            <>
              {isEmpty ? null : (
                <p class="explorer-hint">{t('explorer.hint')}</p>
              )}

              <QuickNotesSection
                files={vaultFiles}
                onOpenNote={props.onSelect}
                onRename={props.onRename}
                onCreate={() => void createQuickNote()}
              />

              {pinnedFiles.length > 0 ? (
                <div class="tree-pinned">
                  <div class="tree-pinned-title">{t('explorer.pinned')}</div>
                  <ul class="tree-pinned-list">
                    {pinnedFiles.map((file) => (
                      <TreeNoteRow
                        key={`pinned-${file.path}`}
                        file={file}
                        currentPath={props.currentPath}
                        depth={0}
                        onSelect={props.onSelect}
                        onContextMenu={props.onContextMenu}
                        onRenameInline={props.onRenameInline}
                        draggingNode={draggingNode}
                        onDragStart={startDrag}
                        onDragEnd={endDrag}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}

              <ul
                class="tree"
                data-testid="file-tree"
                onDragOver={(event) => {
                  // The pointer is over the tree itself and not over a row: there
                  // is no target there, so the drop must not look like a move.
                  if (event.target !== event.currentTarget) return;
                  event.preventDefault();
                  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
                  dragRefusal.current = 'nowhere';
                }}
                onDragLeave={(event) => {
                  // The pointer left the tree: there is no target under it any
                  // more, so the drag must end with an answer.
                  const related = event.relatedTarget as Element | null;
                  if (related && event.currentTarget.contains(related)) return;
                  dragRefusal.current = 'nowhere';
                }}
              >
                {view.folders.map((folder) => (
                  <TreeFolderRow
                    key={folder.node.path}
                    folder={folder}
                    filesByParent={view.filesByParent}
                    currentPath={props.currentPath}
                    expanded={props.expanded}
                    depth={0}
                    onToggle={props.onToggle}
                    onSelect={props.onSelect}
                    onContextMenu={props.onContextMenu}
                    onRenameInline={props.onRenameInline}
                    draggingNode={draggingNode}
                    onDragStart={startDrag}
                    onDragEnd={endDrag}
                    onRefuse={(refusal) => {
                      dragRefusal.current = refusal;
                    }}
                    onDropOnFolder={(_node, targetParentPath) => dropOn(targetParentPath)}
                    noteCountsByPath={noteCountsByPath}
                  />
                ))}
                {rootFiles.map((file) => (
                  <TreeNoteRow
                    key={file.path}
                    file={file}
                    currentPath={props.currentPath}
                    depth={0}
                    onSelect={props.onSelect}
                    onContextMenu={props.onContextMenu}
                    onRenameInline={props.onRenameInline}
                    draggingNode={draggingNode}
                    onDragStart={startDrag}
                    onDragEnd={endDrag}
                  />
                ))}
                {!props.loading && isEmpty ? (
                  <li class="tree-empty">{t('explorer.empty')}</li>
                ) : null}
              </ul>
            </>
          )}

          {/*
            The refusal of a move and the target of the root live *under* the
            tree: a row that appears while the user drags would push the tree
            away under the pointer, and the drop would land on another row.
          */}
          {dropHint ? (
            <p class="tree-drop-hint" role="status">
              {dropHint}
            </p>
          ) : null}

          {drag.path ? (
            <div
              class={`tree-root-drop${rootOver ? ' drop-target' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={t('explorer.moveToRoot')}
              title={t('explorer.moveToRoot')}
              onDragOver={(event) => {
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                setRootOver(true);
              }}
              onDragLeave={() => setRootOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setRootOver(false);
                dropOn('');
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                dropOn('');
              }}
            >
              <span class="tree-icon">
                <Icon name="folder" size={15} />
              </span>
              <span class="nav-item-label">{t('explorer.moveToRoot')}</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
