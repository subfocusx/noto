import type { Node } from '../types';
import type { TreeFolder, TreeNode } from '../lib/tree';

interface SidebarProps {
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
}

interface FolderItemProps {
  folder: TreeFolder;
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
  depth: number;
}

function FolderItem(props: FolderItemProps) {
  const { folder } = props;
  const node = folder.node;
  const isOpen = props.expanded.has(node.path);
  const files = props.filesByParent.get(node.path) ?? [];
  const children: TreeNode[] = folder.children;

  return (
    <li class="tree-folder" style={{ paddingLeft: `${props.depth * 12}px` }}>
      <div class="tree-row">
        <button
          type="button"
          class="tree-toggle"
          aria-expanded={isOpen}
          aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
          onClick={() => props.onToggle(node.path)}
        >
          {isOpen ? '▾' : '▸'}
        </button>
        <span class="tree-name" title={node.path}>
          {node.name}
        </span>
        <span class="tree-actions">
          <button
            type="button"
            class="icon-button"
            title="New note here"
            aria-label={`New note in ${node.name}`}
            onClick={() => props.onCreateFile(node.path)}
          >
            +
          </button>
          <button
            type="button"
            class="icon-button"
            title="New folder here"
            aria-label={`New folder in ${node.name}`}
            onClick={() => props.onCreateFolder(node.path)}
          >
            ▤
          </button>
          <button
            type="button"
            class="icon-button"
            title="Rename"
            aria-label={`Rename ${node.name}`}
            onClick={() => props.onRename(node)}
          >
            ✎
          </button>
          <button
            type="button"
            class="icon-button"
            title="Move"
            aria-label={`Move ${node.name}`}
            onClick={() => props.onMove(node)}
          >
            ↔
          </button>
          <button
            type="button"
            class="icon-button danger"
            title="Delete"
            aria-label={`Delete ${node.name}`}
            onClick={() => props.onDelete(node)}
          >
            ✕
          </button>
        </span>
      </div>
      {isOpen ? (
        <ul class="tree-children">
          {children.map((child) => (
            <FolderItem
              key={child.node.path}
              folder={{ node: child.node, children: child.children }}
              filesByParent={props.filesByParent}
              currentPath={props.currentPath}
              expanded={props.expanded}
              onToggle={props.onToggle}
              onSelect={props.onSelect}
              onCreateFolder={props.onCreateFolder}
              onCreateFile={props.onCreateFile}
              onRename={props.onRename}
              onMove={props.onMove}
              onDelete={props.onDelete}
              depth={props.depth + 1}
            />
          ))}
          {files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              currentPath={props.currentPath}
              onSelect={props.onSelect}
              onRename={props.onRename}
              onMove={props.onMove}
              onDelete={props.onDelete}
              depth={props.depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

interface FileRowProps {
  file: Node;
  currentPath: string;
  onSelect(path: string): void;
  onRename(node: Node): void;
  onMove(node: Node): void;
  onDelete(node: Node): void;
  depth: number;
}

function FileRow(props: FileRowProps) {
  const { file } = props;
  const selected = file.path === props.currentPath;
  return (
    <li class={`tree-file${selected ? ' selected' : ''}`} style={{ paddingLeft: `${props.depth * 12}px` }}>
      <div class="tree-row">
        <button
          type="button"
          class="tree-file-button"
          onClick={() => props.onSelect(file.path)}
          aria-current={selected ? 'true' : undefined}
        >
          {file.name}
        </button>
        <span class="tree-actions">
          <button
            type="button"
            class="icon-button"
            title="Rename"
            aria-label={`Rename ${file.name}`}
            onClick={() => props.onRename(file)}
          >
            ✎
          </button>
          <button
            type="button"
            class="icon-button"
            title="Move"
            aria-label={`Move ${file.name}`}
            onClick={() => props.onMove(file)}
          >
            ↔
          </button>
          <button
            type="button"
            class="icon-button danger"
            title="Delete"
            aria-label={`Delete ${file.name}`}
            onClick={() => props.onDelete(file)}
          >
            ✕
          </button>
        </span>
      </div>
    </li>
  );
}

export function Sidebar(props: SidebarProps) {
  const rootFiles = props.filesByParent.get('') ?? [];
  const isEmpty = props.folders.length === 0 && rootFiles.length === 0;

  return (
    <nav class="sidebar" aria-label="Notes">
      <div class="sidebar-header">
        <span class="brand">Noto</span>
        <div class="sidebar-header-actions">
          <button
            type="button"
            class="icon-button"
            title="Search (Ctrl+K)"
            aria-label="Search notes"
            onClick={props.onOpenSearch}
          >
            ⌕
          </button>
          <button
            type="button"
            class="icon-button"
            title="New note"
            aria-label="New note"
            onClick={() => props.onCreateFile('')}
          >
            ＋
          </button>
          <button
            type="button"
            class="icon-button"
            title="New folder"
            aria-label="New folder"
            onClick={() => props.onCreateFolder('')}
          >
            ▤
          </button>
          <button
            type="button"
            class="icon-button"
            title="Import / Export"
            aria-label="Import and export"
            onClick={props.onOpenTransfer}
          >
            ⇅
          </button>
          <button
            type="button"
            class="icon-button"
            title="Refresh"
            aria-label="Refresh tree"
            onClick={props.onRefresh}
          >
            ⟳
          </button>
        </div>
      </div>

      {props.loading ? <p class="sidebar-hint">Loading…</p> : null}

      <ul class="tree" data-testid="file-tree">
        {props.folders.map((folder) => (
          <FolderItem
            key={folder.node.path}
            folder={folder}
            filesByParent={props.filesByParent}
            currentPath={props.currentPath}
            expanded={props.expanded}
            onToggle={props.onToggle}
            onSelect={props.onSelect}
            onCreateFolder={props.onCreateFolder}
            onCreateFile={props.onCreateFile}
            onRename={props.onRename}
            onMove={props.onMove}
            onDelete={props.onDelete}
            depth={0}
          />
        ))}
        {rootFiles.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            currentPath={props.currentPath}
            onSelect={props.onSelect}
            onRename={props.onRename}
            onMove={props.onMove}
            onDelete={props.onDelete}
            depth={0}
          />
        ))}
        {!props.loading && isEmpty ? (
          <li class="sidebar-hint">No notes yet. Create one with ＋.</li>
        ) : null}
      </ul>

      <div class="sidebar-footer">
        <button type="button" class="text-button" onClick={props.onOpenTrash}>
          🗑 Trash
        </button>
      </div>
    </nav>
  );
}
