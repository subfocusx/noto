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
import { filterTree } from '../../lib/tree';
import { Icon } from '../../ui/icons';
import { IconButton } from '../../ui/tooltip';
import type { TreeContextMenuPayload } from '../TreeContextMenu';
import { TreeFolderRow, TreeNoteRow, type TreeDragState } from '../TreeRow';
import { VaultSwitchMenu } from '../VaultSwitchMenu';

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
  /** Opens the graph of the vault; the feature is not implemented yet. */
  onOpenGraph?(): void;
  /** Opens the archive of the vault; the feature is not implemented yet. */
  onOpenArchive?(): void;
  /** Opens the command palette of the application. */
  onOpenPalette?(): void;
  /** Opens the manager of the plugins. */
  onOpenPlugins?(): void;
}

/** The parent of a path, or the empty string for the root. */
function parentOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function ExplorerSection(props: ExplorerSectionProps) {
  const [drag, setDrag] = useState<TreeDragState>({ path: null, isFolder: false });
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [rootOver, setRootOver] = useState(false);
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
        ? 'Unlock the vault'
        : 'Lock the vault'
      : 'Set up an encrypted storage';
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
   * True when the graph of the vault can be opened.
   *
   * The feature is not implemented yet: the button stays visible, but it is
   * marked as unavailable, so the user knows that it exists.
   */
  const graphReady = props.onOpenGraph !== undefined;

  /** True when the archive of the vault can be opened. */
  const archiveReady = props.onOpenArchive !== undefined;

  /** The end of a drag: every highlight disappears. */
  const endDrag = (): void => {
    setDrag({ path: null, isFolder: false });
    setDropHint(null);
    setRootOver(false);
  };

  /**
   * A node is dropped on a folder.
   *
   * The invalid drops are refused here, so the rows stay simple: a folder
   * cannot be moved into itself or into one of its own descendants, and a
   * node cannot be moved into the folder it already lives in.
   */
  const dropOn = (targetParentPath: string): void => {
    const path = drag.path;
    endDrag();
    if (!path) return;
    const node = nodesByPath.get(path);
    if (!node) return;

    if (node.type === 'folder') {
      if (targetParentPath === node.path || targetParentPath.startsWith(`${node.path}/`)) {
        setDropHint('A folder cannot be moved into itself.');
        return;
      }
    }
    if (parentOf(node.path) === targetParentPath) {
      setDropHint('The note is already here.');
      return;
    }
    setDropHint(null);
    void props.onMoveNode?.(node, targetParentPath);
  };

  return (
    <section class="column-section" aria-label="Explorer">
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
                  ? 'The storage is fixed by the environment (NOTO_VAULT_FIXED)'
                  : props.vaultPath
              }
              aria-label="Change the storage of the notes"
              aria-disabled={props.vaultFixed ? 'true' : undefined}
              aria-haspopup="menu"
              aria-expanded={props.vaultMenuOpen ? 'true' : undefined}
              onClick={toggleMenu}
            >
              {props.vaultPath || 'Choose a folder…'}
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
          title="New note"
          aria-label="New note"
          onClick={() => props.onCreateFile('')}
        >
          <Icon name="file-plus" size={15} />
        </button>
        <button
          type="button"
          class="icon-button"
          title="New folder"
          aria-label="New folder"
          onClick={() => props.onCreateFolder('')}
        >
          <Icon name="folder-plus" size={15} />
        </button>
        <button
          type="button"
          class="icon-button"
          title="Refresh"
          aria-label="Refresh tree"
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
        <div class="sidebar-section">
          <div class="sidebar-section-title">
            <span>
              Explorer
              {filtered ? <span class="q9-filtered-badge">filtered</span> : null}
            </span>
            <div class="sidebar-section-actions" role="group" aria-label="Explorer actions">
              <IconButton
                label="Expand all folders"
                icon="chevrons-down-up"
                onClick={() => props.onExpandAll?.()}
              />
              <IconButton
                label="Collapse all folders"
                icon="chevrons-up-down"
                onClick={() => props.onCollapseAll?.()}
              />
              <IconButton
                label="Graph"
                icon="network"
                ariaDisabled={!graphReady}
                title={graphReady ? 'Graph' : 'Not implemented yet'}
                onClick={() => props.onOpenGraph?.()}
              />
              <IconButton
                label="Archive"
                icon="archive"
                ariaDisabled={!archiveReady}
                title={archiveReady ? 'Archive' : 'Not implemented yet'}
                onClick={() => props.onOpenArchive?.()}
              />
              <IconButton
                label="Open command palette"
                icon="command"
                title="Command palette"
                onClick={() => props.onOpenPalette?.()}
              />
              <IconButton label="Plugins" icon="puzzle" onClick={() => props.onOpenPlugins?.()} />
            </div>
          </div>

          {isEmpty ? null : (
            <p class="explorer-hint">Drag a note onto a folder to move it.</p>
          )}

          {drag.path ? (
            <div
              class={`tree-row${rootOver ? ' drop-target' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Move to the root"
              title="Move to the root"
              onDragOver={(event) => {
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                setRootOver(true);
              }}
              onDragLeave={() => setRootOver(false)}
              onDrop={(event) => {
                event.preventDefault();
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
              <span class="nav-item-label">Move to the root</span>
            </div>
          ) : null}

          {dropHint ? (
            <p class="tree-drop-hint" role="status">
              {dropHint}
            </p>
          ) : null}

          <ul class="tree" data-testid="file-tree">
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
                draggingPath={drag.path}
                onDragStart={setDrag}
                onDragEnd={endDrag}
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
                draggingPath={drag.path}
                onDragStart={setDrag}
                onDragEnd={endDrag}
              />
            ))}
            {!props.loading && isEmpty ? (
              <li class="tree-empty">No notes yet. Create one with the new note button.</li>
            ) : null}
          </ul>
        </div>
      </div>
    </section>
  );
}
