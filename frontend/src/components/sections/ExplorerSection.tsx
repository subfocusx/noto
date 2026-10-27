// The explorer section of the left column.
//
// The section shows the vault with its global actions and the tree of the
// notes. It is the section that is open by default: the notes are what the
// user came for.
//
// The tree of the notes lives here, and so does the state of the drag and drop
// between the folders: the two belong together and nothing else needs them.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Node } from '../../types';
import type { TreeFolder } from '../../lib/tree';
import type { MoveRefusal } from '../../lib/tree';
import { allFiles, allFolderNodes, filterTree, refusalOfMove } from '../../lib/tree';
import {
  findRowByPrefix,
  flattenTreeRows,
  indexOfRow,
  parentRowIndex,
} from '../../lib/treeRows';
import { useAppActions } from '../../core/store/hooks';
import { STORAGE_FIXED_MESSAGE } from '../../core/storages/fixedStorage';
import { pinnedNodes, usePins } from '../../core/pin/pins';
import { isQuickNoteName, quickNoteName, quickNotes } from '../../core/quicknotes/quickNotes';
import { getVaultService } from '../../core/vault/vaultService';
import { useT } from '../../i18n/useT';
import { Icon } from '../../ui/icons';
import type { TreeContextMenuPayload } from '../TreeContextMenu';
import { TreeFolderRow, TreeNoteRow, type TreeDragState } from '../TreeRow';
import { VaultSwitchMenu } from '../VaultSwitchMenu';
import { ArchivePanel } from './ArchivePanel';
import { GraphPanel } from './GraphPanel';
import { ExplorerMenu } from './ExplorerMenu';
import { QuickNotesZone } from './QuickNotesZone';

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
  /**
   * The menu of the actions of the explorer.
   *
   * The header of the column shows two buttons: the new note and the menu.
   * Everything else — the folders, the graph, the archive, the plugins — lives
   * in the menu, so the header stays readable.
   */
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * The button that opens the menu of the actions.
   *
   * A click on it must not close the menu: the button itself decides whether
   * the menu opens or closes.
   */
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
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
   * The button that opens the quick menu of the storage.
   *
   * It is the name of the storage itself: the menu hangs from the name, the
   * way it hangs from the name of the workspace in the other applications.
   *
   * The menu closes itself when the user clicks outside of it. The button that
   * opens it must not be seen as "outside", otherwise the click would close the
   * menu and open it again.
   */
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  /** Opens or closes the quick menu of the storage. */
  const toggleMenu = (): void => {
    if (props.vaultFixed) return;
    setMenuOpen(false);
    props.onVaultMenuToggle?.(!props.vaultMenuOpen);
  };

  /** Opens or closes the menu of the actions of the explorer. */
  const toggleActions = (): void => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    props.onVaultMenuToggle?.(false);
    setMenuOpen(true);
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

  /**
   * The quick notes, shown as a group at the top of the tree.
   *
   * When the user searches, the tree shows the result of the search as it
   * is: the group would be a second, contradicting answer.
   */
  const groupNotes = useMemo(
    () => (filtered ? [] : quickNotes(vaultFiles)),
    [filtered, vaultFiles],
  );

  /**
   * The notes of the root of the tree, without the quick notes.
   *
   * A quick note is shown in the group and nowhere else: a note that is
   * shown twice is a note the user cannot trust.
   */
  const treeRootFiles = useMemo(
    () => (filtered ? rootFiles : rootFiles.filter((file) => !isQuickNoteName(file.name))),
    [filtered, rootFiles],
  );

  const isEmpty = view.folders.length === 0 && treeRootFiles.length === 0 && groupNotes.length === 0;

  /**
   * The rows of the tree the user can reach with the keyboard.
   *
   * The list follows what is drawn: a folded folder hides its notes, and a
   * note that the filter of the user left out is not reachable.
   */
  const visibleRows = useMemo(
    () => flattenTreeRows(view.folders, treeRootFiles, view.filesByParent, props.expanded),
    [view.folders, treeRootFiles, view.filesByParent, props.expanded],
  );

  /** The row that holds the keyboard of the tree. */
  const [activeRowPath, setActiveRowPath] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement | null>(null);
  /** The letters of the quick jump, with the moment of the last letter. */
  const typeAhead = useRef({ buffer: '', at: 0 });

  /**
   * The button of a row: the name of the note or of the folder.
   *
   * The keyboard moves the focus to that button, so the row that is reached
   * is the row that is seen.
   */
  const rowButtonOf = (path: string): HTMLElement | null => {
    const list = treeRef.current;
    if (!list) return null;
    for (const row of Array.from(list.querySelectorAll<HTMLElement>('[data-tree-path]'))) {
      if (row.dataset.treePath !== path) continue;
      return row.querySelector<HTMLElement>('button.tree-file-button, button.tree-folder-button');
    }
    return null;
  };

  /** Moves the focus to a row of the tree. */
  const focusRow = (path: string): void => {
    setActiveRowPath(path);
    const button = rowButtonOf(path);
    if (button) button.focus();
  };

  /**
   * The path of the row that has the focus of the browser.
   *
   * The pointer can put the focus on a row that the state does not know yet,
   * so the keyboard asks the document and not only the state.
   */
  const focusedRowPath = (): string | null => {
    const list = treeRef.current;
    const active = list ? document.activeElement : null;
    if (!active || !list || !list.contains(active)) return activeRowPath;
    const row = active.closest<HTMLElement>('[data-tree-path]');
    return row?.dataset.treePath ?? activeRowPath;
  };

  /**
   * One tab stop for the whole tree.
   *
   * The rows of a tree are a list, not a set of fields: the tab key walks
   * the tree of the application, and the arrow keys walk the tree of the
   * notes.
   */
  useEffect(() => {
    const list = treeRef.current;
    if (!list) return;
    const active =
      activeRowPath && visibleRows.some((row) => row.path === activeRowPath)
        ? activeRowPath
        : visibleRows[0]?.path ?? null;
    // Every button of a row leaves the tab order: the chevron of a folder is
    // not a field of its own, the row is.
    const buttons = Array.from(list.querySelectorAll<HTMLElement>('.tree-row button'));
    for (const button of buttons) button.tabIndex = -1;
    if (active === null) return;
    for (const row of Array.from(list.querySelectorAll<HTMLElement>('[data-tree-path]'))) {
      if (row.dataset.treePath !== active) continue;
      const name = row.querySelector<HTMLElement>('button.tree-file-button, button.tree-folder-button');
      if (name) name.tabIndex = 0;
    }
  }, [visibleRows, activeRowPath]);

  /**
   * The keyboard of the tree.
   *
   * The tree is a list of files: the arrow keys walk it, the folders fold
   * and unfold like in every file manager, `Enter` opens a note, `F2` renames
   * the row that has the focus, and the letters jump to the note that starts
   * with them.
   */
  const handleTreeKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLUListElement>): void => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    // The user who renames a row is typing a name, not walking the tree.
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const rows = visibleRows;
    if (rows.length === 0) return;
    const current = indexOfRow(rows, focusedRowPath());
    const key = event.key;

    const move = (index: number): void => {
      if (index < 0 || index >= rows.length) return;
      event.preventDefault();
      focusRow(rows[index].path);
    };

    if (key === 'ArrowDown') {
      move(current < 0 ? 0 : current + 1);
      return;
    }
    if (key === 'ArrowUp') {
      move(current < 0 ? 0 : current - 1);
      return;
    }
    if (key === 'Home') {
      move(0);
      return;
    }
    if (key === 'End') {
      move(rows.length - 1);
      return;
    }

    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      if (current < 0) {
        move(0);
        return;
      }
      const row = rows[current];
      if (key === 'ArrowRight') {
        // A folded folder unfolds, an open folder gives its first row.
        if (row.kind === 'folder') {
          if (!props.expanded.has(row.path)) {
            event.preventDefault();
            props.onToggle(row.path);
            return;
          }
          const child = rows[current + 1];
          if (child && child.depth > row.depth) move(current + 1);
        }
        return;
      }
      // An open folder folds, a row that lies inside a folder goes to it.
      if (row.kind === 'folder' && props.expanded.has(row.path)) {
        event.preventDefault();
        props.onToggle(row.path);
        return;
      }
      const parent = parentRowIndex(rows, current);
      if (parent >= 0) move(parent);
      return;
    }

    if (key === 'Enter' || key === ' ') {
      if (current < 0) {
        move(0);
        return;
      }
      const row = rows[current];
      event.preventDefault();
      if (row.kind === 'folder') props.onToggle(row.path);
      else props.onSelect(row.path);
      return;
    }

    // The quick jump by letters: the user types the beginning of the name of
    // a note and the tree jumps to it.
    if (key.length !== 1 || key === ' ' || !/\S/.test(key)) return;
    const now = Date.now();
    const state = typeAhead.current;
    const buffer = now - state.at > 800 ? key : state.buffer + key;
    typeAhead.current = { buffer, at: now };
    const found = findRowByPrefix(rows, buffer, current < 0 ? -1 : current);
    if (found >= 0) {
      event.preventDefault();
      focusRow(rows[found].path);
    }
  };

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

  /**
   * The name of the storage in the header.
   *
   * When no storage is open, the name is the invitation to choose one: the
   * header of the column is where the user looks for it.
   */
  const vaultLabel =
    !props.vaultPath && props.onChooseVault
      ? t('explorer.chooseFolder')
      : (props.vaultName ?? 'Noto');

  return (
    <section class="column-section" aria-label={t('section.explorer')}>
      {/*
        The header of the column is one line: the icon of the storage, its
        name and the actions of the explorer. The name is the button of the
        quick menu of the storage, the way the other applications do it
        (Obsidian, Notion): the full path is a detail, so it lives in the
        tooltip of the name and in the menu itself, not in a second line.
      */}
      <header class="column-header vault-header">
        <span class="vault-header-icon" aria-hidden="true">
          <Icon name="folder" size={16} />
        </span>
        {props.onChooseVault ? (
          <button
            type="button"
            class="vault-header-name"
            ref={triggerRef}
            title={props.vaultFixed ? t('explorer.storageFixed') : props.vaultPath}
            aria-label={t('explorer.changeStorageNamed', { name: vaultLabel })}
            aria-disabled={props.vaultFixed ? 'true' : undefined}
            aria-haspopup="menu"
            aria-expanded={props.vaultMenuOpen ? 'true' : undefined}
            onClick={toggleMenu}
          >
            <span class="vault-header-name-text">{vaultLabel}</span>
            <Icon name="chevron-down" size={13} class="vault-header-chevron" />
          </button>
        ) : (
          <span class="vault-header-name vault-header-name-static" title={props.vaultPath}>
            <span class="vault-header-name-text">{vaultLabel}</span>
          </span>
        )}
        <span class="vault-header-actions">
          <button
            type="button"
            class="icon-button"
            title={t('tree.newNote')}
            aria-label={t('tree.newNote')}
            onClick={() => props.onCreateFile('')}
          >
            <Icon name="plus" size={15} />
          </button>
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
            ref={menuTriggerRef}
            title={t('explorer.actions')}
            aria-label={t('explorer.actions')}
            aria-haspopup="menu"
            aria-expanded={menuOpen ? 'true' : undefined}
            onClick={toggleActions}
          >
            <Icon name="more-horizontal" size={15} />
          </button>
        </span>
        {menuOpen ? (
          <ExplorerMenu
            onOpenGraph={openGraph}
            onOpenPlugins={props.onOpenPlugins}
            triggerRef={menuTriggerRef}
            onClose={() => setMenuOpen(false)}
          />
        ) : null}
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
          {/*
            The explorer has no title of its own: the header of the column
            already says which storage the tree belongs to, and a second
            title would only repeat it. The badge of the filter is the one
            thing the user has to be told about the state of the tree.
          */}
          {filtered ? (
            <div class="explorer-filtered-row">
              <span class="q9-filtered-badge">{t('explorer.filtered')}</span>
            </div>
          ) : null}

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
              {/*
                The actions of the tree: the two bulk actions of the folders,
                the creation of a folder, the fresh tree, the archive and the
                palette of the commands. They stay on the face of the column:
                they are the actions of the tree itself, and a tree that hides
                the way to open every folder is a tree the user must guess.
              */}
              <div class="explorer-actions" role="group" aria-label={t('explorer.actions')}>
                <button
                  type="button"
                  class="icon-button explorer-action"
                  title={t('explorer.expandAll')}
                  aria-label={t('explorer.expandAll')}
                  onClick={() => props.onExpandAll?.()}
                >
                  <Icon name="chevrons-down-up" size={14} />
                </button>
                <button
                  type="button"
                  class="icon-button explorer-action"
                  title={t('explorer.collapseAll')}
                  aria-label={t('explorer.collapseAll')}
                  onClick={() => props.onCollapseAll?.()}
                >
                  <Icon name="chevrons-up-down" size={14} />
                </button>
                <button
                  type="button"
                  class="icon-button explorer-action"
                  title={t('tree.newFolder')}
                  aria-label={t('tree.newFolder')}
                  onClick={() => props.onCreateFolder('')}
                >
                  <Icon name="folder-plus" size={14} />
                </button>
                <button
                  type="button"
                  class="icon-button explorer-action"
                  title={t('explorer.refreshTree')}
                  aria-label={t('explorer.refreshTree')}
                  onClick={() => props.onRefresh()}
                >
                  <Icon name="refresh-cw" size={14} />
                </button>
                <button
                  type="button"
                  class="icon-button explorer-action"
                  title={t('explorer.archive')}
                  aria-label={t('explorer.archive')}
                  onClick={openArchive}
                >
                  <Icon name="archive" size={14} />
                </button>
                <button
                  type="button"
                  class="icon-button explorer-action"
                  title={t('explorer.palette')}
                  aria-label={t('explorer.palette')}
                  onClick={() => props.onOpenPalette?.()}
                >
                  <Icon name="command" size={14} />
                </button>
              </div>

              {/*
                The quick notes stand above the tree, in a zone of their own:
                a quick note is a scratch, not a place in the structure of the
                vault. A line separates the two, so the eye never reads a
                scratch as a folder.
              */}
              <QuickNotesZone
                notes={groupNotes}
                currentPath={props.currentPath}
                onOpenNote={props.onSelect}
                onContextMenu={props.onContextMenu}
                onRenameInline={props.onRenameInline}
                draggingNode={draggingNode}
                onDragStart={startDrag}
                onDragEnd={endDrag}
                onCreate={() => void createQuickNote()}
              />
              <div class="tree-zone-divider" />

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

              {/*
                The head of the tree of the vault. It carries the number of the
                notes it holds, so the user knows how big the vault is without
                counting the rows.
              */}
              <div class="tree-zone-head tree-zone-notes-head">
                <span class="tree-zone-spacer" />
                <span class="tree-zone-label">{t('explorer.notes')}</span>
                {filtered ? null : (
                  <span class="tree-zone-count">{vaultFiles.length - groupNotes.length}</span>
                )}
              </div>

              <ul
                class="tree"
                data-testid="file-tree"
                ref={treeRef}
                onKeyDown={handleTreeKeyDown}
                onClick={(event) => {
                  // The pointer also moves the keyboard: the row that the
                  // user clicked is the row that the arrows continue from.
                  const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(
                    '[data-tree-path]',
                  );
                  if (row) setActiveRowPath(row.dataset.treePath ?? null);
                }}
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
                {treeRootFiles.map((file) => (
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

              {/*
                The hint of the drag lives under the tree: it explains what the
                tree can do, and it stays there instead of following the
                pointer.
              */}
              <p class="explorer-hint">{t('explorer.hint')}</p>
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
