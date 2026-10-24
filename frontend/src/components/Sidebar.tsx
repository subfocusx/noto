// The vault column of the application.
//
// The column holds the header of the vault with its global actions, the list
// of the views (all notes, recent, trash), the tree of the notes and the
// footer with the secondary actions.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ConnectionState, Node } from '../types';
import type { TreeFolder } from '../lib/tree';
import { Icon } from '../ui/icons';
import { IconButton } from '../ui/tooltip';
import { ColumnResizer } from './ColumnResizer';
import { ConnectionIndicator } from './ConnectionIndicator';
import { RecentNotesPanel } from './RecentNotesPanel';
import { QueryBar } from './QueryBar';
import { SavedViews } from './SavedViews';
import { TagTree } from './TagTree';
import type { TreeContextMenuPayload } from './TreeContextMenu';
import { TreeFolderRow, TreeNoteRow, type TreeDragState } from './TreeRow';

export interface SidebarProps {
  folders: TreeFolder[];
  filesByParent: Map<string, Node[]>;
  currentPath: string;
  expanded: Set<string>;
  onToggle(path: string): void;
  onSelect(path: string): void;
  onCreateFolder(parentPath: string): void;
  onCreateFile(parentPath: string): void;
  onRename(node: Node): void;
  onMove(node: Node): void;
  onDelete(node: Node): void;
  onOpenTrash(): void;
  /** Opens the search of the notes. */
  onOpenSearch?(): void;
  /** Opens the graph of the vault; the feature is not implemented yet. */
  onOpenGraph?(): void;
  /** Opens the archive of the vault; the feature is not implemented yet. */
  onOpenArchive?(): void;
  /** Opens the command palette of the application. */
  onOpenPalette?(): void;
  /** Opens the manager of the plugins. */
  onOpenPlugins?(): void;
  /** The state of the connection with the backend. */
  connection?: ConnectionState;
  /** Called when the user asks the application to check the backend again. */
  onRetryConnection?(): void;
  onOpenTransfer(): void;
  onRefresh(): void;
  loading: boolean;
  /** The name of the vault. */
  vaultName?: string;
  /** The path of the vault on the disk. */
  vaultPath?: string;
  /** The number of the notes of the vault. */
  noteCount?: number;
  /** The paths of the recently opened notes. */
  recentPaths?: string[];
  /** Called when a recent note is opened. */
  onOpenRecent?: (path: string) => void;
  /** Called when a recent note is removed from the list. */
  onRemoveRecent?: (path: string) => void;
  /**
   * The paths that currently exist in the tree.
   *
   * When it is missing, the sidebar computes it from the tree it shows.
   */
  knownPaths?: string[];
  /** Called when the user asks for the menu of a row. */
  onContextMenu?: (payload: TreeContextMenuPayload) => void;
  /** Called when a row is renamed in place. */
  onRenameInline?: (node: Node, name: string) => void | Promise<void>;
  /** Called when a node is dropped on another folder. */
  onMoveNode?: (node: Node, targetParentPath: string) => void | Promise<void>;
  /** True when the sidebar is collapsed. */
  collapsed?: boolean;
  /** Called when the user collapses or expands the sidebar. */
  onToggleCollapse?: () => void;
  /** The width of the sidebar, in pixels. */
  sidebarWidth?: number;
  /** Called when the user resizes the sidebar. */
  onResizeWidth?: (width: number) => void;
  /** The sort order of the tree. */
  treeSort?: 'name' | 'modified';
  /** Called when the user asks for the dialog of the choice of the storage. */
  onChooseVault?: () => void;
  /** True when the storage is fixed by the environment and cannot be changed. */
  vaultFixed?: boolean;
  /** The total number of the folders of the vault. */
  folderTotal?: number;
  /** False when the counters of the tree are hidden. */
  showCounts?: boolean;
  /** The total number of the notes of the vault. */
  noteTotal?: number;
  /** True when the list of the recent notes is collapsed. */
  recentCollapsed?: boolean;
  /** Called when the user folds or unfolds the list of the recent notes. */
  onToggleRecent?: () => void;
  /** The contributions of the plugins, shown above the footer. */
  children?: ComponentChildren;
  /**
   * True when at least one plugin contributes to the footer of the column.
   *
   * The area of the plugins is only rendered when it holds something: an
   * empty strip would look like a broken border under the tree.
   */
  hasPluginItems?: boolean;
}

/** The smallest width of the sidebar, in pixels. */
const MIN_WIDTH = 180;

/** The parent of a path, or the empty string for the root. */
function parentOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function Sidebar(props: SidebarProps) {
  const rootFiles = props.filesByParent.get('') ?? [];
  const isEmpty = props.folders.length === 0 && rootFiles.length === 0;
  const navRef = useRef<HTMLElement | null>(null);
  const recentRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<TreeDragState>({ path: null, isFolder: false });
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [rootOver, setRootOver] = useState(false);

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

  const knownPaths = useMemo(
    () => props.knownPaths ?? Array.from(nodesByPath.keys()),
    [props.knownPaths, nodesByPath],
  );

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

  const noteCount = useMemo(() => {
    if (props.noteCount !== undefined) return props.noteCount;
    let count = 0;
    for (const files of props.filesByParent.values()) count += files.length;
    return count;
  }, [props.noteCount, props.filesByParent]);

  /**
   * True when the graph of the vault can be opened.
   *
   * The feature is not implemented yet: the button stays visible, but it is
   * marked as unavailable, so the user knows that it exists.
   */
  const graphReady = props.onOpenGraph !== undefined;

  /** True when the archive of the vault can be opened. */
  const archiveReady = props.onOpenArchive !== undefined;

  // The width of the sidebar is a property of the wrapper: the sidebar only
  // tells it which width it wants.
  useEffect(() => {
    const wrap = navRef.current?.parentElement;
    if (!wrap) return;
    if (props.sidebarWidth === undefined) {
      wrap.style.removeProperty('--sidebar-width');
      return;
    }
    wrap.style.setProperty('--sidebar-width', `${props.sidebarWidth}px`);
  }, [props.sidebarWidth]);

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

  const scrollToRecent = (): void => {
    recentRef.current?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <nav ref={navRef} class="sidebar" aria-label="Notes">
      <div class="vault-header">
        <span class="vault-header-icon">
          <Icon name="folder" size={15} />
        </span>
        <span class="vault-header-name">{props.vaultName ?? 'Noto'}</span>
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
            onClick={() => {
              if (props.vaultFixed) return;
              props.onChooseVault?.();
            }}
          >
            {props.vaultPath || 'Choose a folder…'}
          </button>
        ) : (
          <span class="vault-header-path" title={props.vaultPath}>
            {props.vaultPath}
          </span>
        )}
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
      </div>

      <div class="sidebar-scroll">
        <ul class="nav-list">
          <li>
            <button type="button" class="nav-item active">
              <span class="nav-item-icon">
                <Icon name="file-text" size={15} />
              </span>
              <span class="nav-item-label">All notes</span>
              <span class="nav-item-count">{noteCount}</span>
            </button>
          </li>
          <li>
            <button type="button" class="nav-item" onClick={scrollToRecent}>
              <span class="nav-item-icon">
                <Icon name="refresh-cw" size={15} />
              </span>
              <span class="nav-item-label">Recent</span>
            </button>
          </li>
          <li>
            <button type="button" class="nav-item" onClick={props.onOpenTrash}>
              <span class="nav-item-icon">
                <Icon name="trash" size={15} />
              </span>
              <span class="nav-item-label">Trash</span>
            </button>
          </li>
        </ul>

        <div class="sidebar-section q8-section">
          <div class="sidebar-section-title">
            <span>Query</span>
          </div>
          <QueryBar />
          <SavedViews />
          <TagTree />
        </div>

        <div class="sidebar-section">
          <div class="sidebar-section-title">
            <span>Explorer</span>
            <div class="sidebar-section-actions" role="group" aria-label="Explorer actions">
              <IconButton label="Search notes" icon="search" onClick={() => props.onOpenSearch?.()} />
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
              <IconButton label="Plugins" icon="bookmark" onClick={() => props.onOpenPlugins?.()} />
              <ConnectionIndicator
                connection={props.connection ?? 'connecting'}
                onRetry={props.onRetryConnection}
              />
            </div>
          </div>

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
            {props.folders.map((folder) => (
              <TreeFolderRow
                key={folder.node.path}
                folder={folder}
                filesByParent={props.filesByParent}
                currentPath={props.currentPath}
                expanded={props.expanded}
                depth={0}
                onToggle={props.onToggle}
                onSelect={props.onSelect}
                onCreateFolder={props.onCreateFolder}
                onCreateFile={props.onCreateFile}
                onRename={props.onRename}
                onMove={props.onMove}
                onDelete={props.onDelete}
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
                onRename={props.onRename}
                onMove={props.onMove}
                onDelete={props.onDelete}
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

        {props.recentPaths && props.recentPaths.length > 0 ? (
          <div ref={recentRef}>
            <RecentNotesPanel
              paths={props.recentPaths}
              knownPaths={knownPaths}
              collapsed={props.recentCollapsed}
              onToggleCollapsed={props.onToggleRecent}
              onOpen={(path) => (props.onOpenRecent ?? props.onSelect)(path)}
              onRemove={(path) => props.onRemoveRecent?.(path)}
            />
          </div>
        ) : null}
      </div>

      {props.hasPluginItems && props.children ? (
        <div class="noto-plugin-sidebar-area">{props.children}</div>
      ) : null}

      <div class="sidebar-footer">
        <span class="muted">{noteCount} notes</span>
        <button
          type="button"
          class="icon-button"
          title="Import and export"
          aria-label="Import and export"
          onClick={props.onOpenTransfer}
        >
          <Icon name="upload" size={15} />
        </button>
        <button
          type="button"
          class="icon-button"
          title="Trash"
          aria-label="Trash"
          onClick={props.onOpenTrash}
        >
          <Icon name="trash" size={15} />
        </button>
        {props.onToggleCollapse ? (
          <button
            type="button"
            class="icon-button"
            title={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={props.onToggleCollapse}
          >
            <Icon name="panel-left" size={15} />
          </button>
        ) : null}
      </div>

      {props.onResizeWidth ? (
        <ColumnResizer
          side="left"
          label="Resize sidebar"
          min={MIN_WIDTH}
          max={420}
          onResize={props.onResizeWidth}
        />
      ) : null}
    </nav>
  );
}
