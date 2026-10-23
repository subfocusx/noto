// The sidebar of the application.
//
// The sidebar holds the header with the global actions, the list of the
// recently opened notes, the tree of the notes and the footer with the
// trash.
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { Node } from '../types';
import type { TreeFolder } from '../lib/tree';
import { Icon } from '../ui/icons';
import { RecentNotesPanel } from './RecentNotesPanel';
import type { TreeContextMenuPayload } from './TreeContextMenu';
import { TreeFolderRow, TreeNoteRow } from './TreeRow';

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
  onOpenSearch(): void;
  onOpenTransfer(): void;
  onRefresh(): void;
  loading: boolean;
  /** The paths of the recently opened notes. */
  recentPaths?: string[];
  /**
   * The paths that currently exist in the tree.
   *
   * When it is missing, the sidebar computes it from the tree it shows.
   */
  knownPaths?: string[];
  /** Called when a recent note is opened. */
  onOpenRecent?: (path: string) => void;
  /** Called when a recent note is removed from the list. */
  onRemoveRecent?: (path: string) => void;
  /** Called when the user asks for the menu of a row. */
  onContextMenu?: (payload: TreeContextMenuPayload) => void;
  /** Called when a row is renamed in place. */
  onRenameInline?: (node: Node, name: string) => void | Promise<void>;
  /** True when the sidebar is collapsed. */
  collapsed?: boolean;
  /** Called when the user collapses or expands the sidebar. */
  onToggleCollapse?: () => void;
  /** The width of the sidebar, in pixels. */
  sidebarWidth?: number;
  /** Called when the user resizes the sidebar. */
  onResizeWidth?: (width: number) => void;
}

/** The smallest width of the sidebar, in pixels. */
const MIN_WIDTH = 180;

export function Sidebar(props: SidebarProps) {
  const rootFiles = props.filesByParent.get('') ?? [];
  const isEmpty = props.folders.length === 0 && rootFiles.length === 0;
  const navRef = useRef<HTMLElement | null>(null);

  // Every node of the tree, indexed by its path: the menu needs the node of
  // the path it was opened on.
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

  const startResize = (event: PointerEvent): void => {
    const wrap = navRef.current?.parentElement;
    if (!wrap || !props.onResizeWidth) return;
    const rect = wrap.getBoundingClientRect();
    const startX = event.clientX;
    const startWidth = rect.width;

    const move = (moveEvent: PointerEvent): void => {
      const width = startWidth + (moveEvent.clientX - startX);
      props.onResizeWidth?.(Math.max(MIN_WIDTH, Math.round(width)));
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return (
    <nav ref={navRef} class="sidebar" aria-label="Notes">
      <div class="sidebar-header">
        <span class="brand">Noto</span>
        <div class="sidebar-header-actions">
          <button
            type="button"
            class="icon-button"
            title="Search notes"
            aria-label="Search notes"
            onClick={props.onOpenSearch}
          >
            <Icon name="search" size={16} />
          </button>
          <button
            type="button"
            class="icon-button"
            title="New note"
            aria-label="New note"
            onClick={() => props.onCreateFile('')}
          >
            <Icon name="plus" size={16} />
          </button>
          <button
            type="button"
            class="icon-button"
            title="New folder"
            aria-label="New folder"
            onClick={() => props.onCreateFolder('')}
          >
            <Icon name="folder-plus" size={16} />
          </button>
          <button
            type="button"
            class="icon-button"
            title="Import and export"
            aria-label="Import and export"
            onClick={props.onOpenTransfer}
          >
            <Icon name="upload" size={16} />
          </button>
          <button
            type="button"
            class="icon-button"
            title="Refresh tree"
            aria-label="Refresh tree"
            onClick={props.onRefresh}
          >
            <Icon name="refresh-cw" size={16} />
          </button>
          {props.onToggleCollapse ? (
            <button
              type="button"
              class="icon-button"
              title={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={props.onToggleCollapse}
            >
              <Icon name="panel-right" size={16} />
            </button>
          ) : null}
        </div>
      </div>

      <div class="sidebar-scroll">
        {props.recentPaths && props.recentPaths.length > 0 ? (
          <RecentNotesPanel
            paths={props.recentPaths}
            knownPaths={knownPaths}
            onOpen={(path) => (props.onOpenRecent ?? props.onSelect)(path)}
            onRemove={(path) => props.onRemoveRecent?.(path)}
          />
        ) : null}

        {props.loading ? <p class="sidebar-hint">Loading</p> : null}

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
            />
          ))}
          {!props.loading && isEmpty ? (
            <li class="sidebar-empty">No notes yet. Create one with the new note button.</li>
          ) : null}
        </ul>
      </div>

      <div class="sidebar-footer">
        <button type="button" class="text-button" onClick={props.onOpenTrash}>
          <Icon name="trash" size={16} />
          Trash
        </button>
      </div>

      {props.onResizeWidth ? (
        <div
          class="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          onPointerDown={startResize}
        />
      ) : null}
    </nav>
  );
}
