// The rows of the tree.
//
// A row is a line of the file tree: a folder with its toggle, its name and
// its actions, or a note with its name and its actions. Both rows can be
// renamed in place with a double click, and both rows can be dragged to
// another folder.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Node } from '../types';
import type { TreeFolder } from '../lib/tree';
import { useOverflowTitle } from '../lib/useOverflowTitle';
import { Icon } from '../ui/icons';
import type { TreeContextMenuPayload } from './TreeContextMenu';

/** The deepest level that is indented; deeper rows share the last step. */
const MAX_DEPTH = 8;

/** The width of one indentation step, in pixels. */
const INDENT_STEP = 14;

/** The state of a drag, shared by every row of the tree. */
export interface TreeDragState {
  /** The path of the node that is being dragged. */
  path: string | null;
  /** True when the dragged node is a folder. */
  isFolder: boolean;
}

export interface TreeFolderRowProps {
  /** The folder and its children. */
  folder: TreeFolder;
  /** The notes of every folder, grouped by parent path. */
  filesByParent: Map<string, Node[]>;
  /** The path of the note that is open. */
  currentPath: string;
  /** The paths of the expanded folders. */
  expanded: Set<string>;
  /** The depth of the row in the tree. */
  depth: number;
  onToggle(path: string): void;
  onSelect(path: string): void;
  onCreateFolder(parentPath: string): void;
  onCreateFile(parentPath: string): void;
  onRename(node: Node): void;
  onMove(node: Node): void;
  onDelete(node: Node): void;
  onContextMenu?(payload: TreeContextMenuPayload): void;
  onRenameInline?(node: Node, name: string): void | Promise<void>;
  /** The path of the node that is currently dragged, if any. */
  draggingPath?: string | null;
  /** Called when a drag starts. */
  onDragStart?(state: TreeDragState): void;
  /** Called when a drag ends. */
  onDragEnd?(): void;
  /** Called when a node is dropped on a folder. */
  onDropOnFolder?(node: Node, targetParentPath: string): void;
}

export interface TreeNoteRowProps {
  /** The note of the row. */
  file: Node;
  /** The path of the note that is open. */
  currentPath: string;
  /** The depth of the row in the tree. */
  depth: number;
  onSelect(path: string): void;
  onRename(node: Node): void;
  onMove(node: Node): void;
  onDelete(node: Node): void;
  onContextMenu?(payload: TreeContextMenuPayload): void;
  onRenameInline?(node: Node, name: string): void | Promise<void>;
  /** The path of the node that is currently dragged, if any. */
  draggingPath?: string | null;
  /** Called when a drag starts. */
  onDragStart?(state: TreeDragState): void;
  /** Called when a drag ends. */
  onDragEnd?(): void;
}

interface InlineRename {
  renaming: boolean;
  value: string;
  error: string | null;
  inputRef: { current: HTMLInputElement | null };
  start(): void;
  change(value: string): void;
  commit(): void;
  cancel(): void;
}

/** The padding of the row, in pixels. */
function indentOf(depth: number): number {
  return Math.min(depth, MAX_DEPTH) * INDENT_STEP;
}

/**
 * Checks a new name.
 *
 * Returns the message of the error, or null when the name is valid.
 */
function validateName(name: string): string | null {
  if (name.length === 0) return 'The name cannot be empty.';
  if (name.includes('/') || name.includes('\\')) {
    return 'The name cannot contain a slash.';
  }
  if (/[\u0000-\u001f]/.test(name)) {
    return 'The name cannot contain control characters.';
  }
  return null;
}

/** The state of the inline rename of a row. */
function useInlineRename(
  node: Node,
  onRenameInline?: (node: Node, name: string) => void | Promise<void>,
): InlineRename {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(node.name);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Tells whether the rename is over, so a blur after a validation does not
  // cancel the edit.
  const settled = useRef(false);

  useEffect(() => {
    if (!renaming) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [renaming]);

  const start = (): void => {
    if (!onRenameInline) return;
    settled.current = false;
    setValue(node.name);
    setError(null);
    setRenaming(true);
  };

  const change = (next: string): void => {
    setValue(next);
  };

  const cancel = (): void => {
    settled.current = true;
    setRenaming(false);
    setError(null);
  };

  const commit = (): void => {
    if (settled.current) return;
    const name = value.trim();
    const problem = validateName(name);
    if (problem) {
      setError(problem);
      return;
    }
    settled.current = true;
    setRenaming(false);
    if (name !== node.name) void onRenameInline?.(node, name);
  };

  return { renaming, value, error, inputRef, start, change, commit, cancel };
}

/** The rename field of a row. */
function RenameInput(props: {
  rename: InlineRename;
  label: string;
}) {
  const { rename } = props;
  return (
    <input
      ref={rename.inputRef}
      class="tree-rename-input"
      type="text"
      aria-label={props.label}
      value={rename.value}
      onInput={(event) => rename.change((event.currentTarget as HTMLInputElement).value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          rename.commit();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          rename.cancel();
        }
      }}
      onBlur={() => rename.cancel()}
    />
  );
}

/** The actions of a row. */
function RowActions(props: {
  node: Node;
  isFolder: boolean;
  onRename(node: Node): void;
  onMove(node: Node): void;
  onDelete(node: Node): void;
  onCreateFile?(parentPath: string): void;
  onCreateFolder?(parentPath: string): void;
  onContextMenu?(payload: TreeContextMenuPayload): void;
}) {
  const { node } = props;
  return (
    <span class="tree-actions">
      {props.isFolder && props.onCreateFile ? (
        <button
          type="button"
          class="icon-button"
          title={`New note in ${node.name}`}
          aria-label={`New note in ${node.name}`}
          onClick={() => props.onCreateFile?.(node.path)}
        >
          <Icon name="plus" size={14} />
        </button>
      ) : null}
      {props.isFolder && props.onCreateFolder ? (
        <button
          type="button"
          class="icon-button"
          title={`New folder in ${node.name}`}
          aria-label={`New folder in ${node.name}`}
          onClick={() => props.onCreateFolder?.(node.path)}
        >
          <Icon name="folder-plus" size={14} />
        </button>
      ) : null}
      <button
        type="button"
        class="icon-button"
        title={`Rename ${node.name}`}
        aria-label={`Rename ${node.name}`}
        onClick={() => props.onRename(node)}
      >
        <Icon name="pencil" size={14} />
      </button>
      <button
        type="button"
        class="icon-button"
        title={`Move ${node.name}`}
        aria-label={`Move ${node.name}`}
        onClick={() => props.onMove(node)}
      >
        <Icon name="move" size={14} />
      </button>
      <button
        type="button"
        class="icon-button danger"
        title={`Delete ${node.name}`}
        aria-label={`Delete ${node.name}`}
        onClick={() => props.onDelete(node)}
      >
        <Icon name="trash" size={14} />
      </button>
      {props.onContextMenu ? (
        <button
          type="button"
          class="icon-button"
          title={`Menu ${node.name}`}
          aria-label={`Menu ${node.name}`}
          onClick={(event) => {
            props.onContextMenu?.({
              path: node.path,
              isFolder: node.type === 'folder',
              x: event.clientX,
              y: event.clientY,
            });
          }}
        >
          <Icon name="more-horizontal" size={14} />
        </button>
      ) : null}
    </span>
  );
}

/** The name of a row, cut off with an ellipsis when it does not fit. */
function TreeName(props: { name: string }) {
  const overflow = useOverflowTitle(props.name);
  return (
    <span class="tree-name" ref={overflow.ref} title={overflow.title}>
      {props.name}
    </span>
  );
}

/** A folder of the tree, with its children. */
export function TreeFolderRow(props: TreeFolderRowProps) {
  const { folder } = props;
  const node = folder.node;
  const isOpen = props.expanded.has(node.path);
  const files = props.filesByParent.get(node.path) ?? [];
  const rename = useInlineRename(node, props.onRenameInline);
  const [over, setOver] = useState(false);
  const isDragging = props.draggingPath === node.path;

  // The highlight of a drop target disappears with the drag itself.
  useEffect(() => {
    if (!props.draggingPath) setOver(false);
  }, [props.draggingPath]);

  const handleDragStart = (event: DragEvent): void => {
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', node.path);
      event.dataTransfer.effectAllowed = 'move';
    }
    props.onDragStart?.({ path: node.path, isFolder: true });
  };

  const handleDragOver = (event: DragEvent): void => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setOver(true);
  };

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault();
    setOver(false);
    props.onDropOnFolder?.(node, node.path);
  };

  return (
    <li class="tree-folder">
      <div
        class={`tree-row${isDragging ? ' dragging' : ''}${over ? ' drop-target' : ''}`}
        style={{ paddingLeft: `${indentOf(props.depth)}px` }}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={() => props.onDragEnd?.()}
        onDragOver={handleDragOver}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
      >
        <button
          type="button"
          class="tree-toggle"
          aria-expanded={isOpen}
          aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
          title={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
          onClick={() => props.onToggle(node.path)}
        >
          <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
        </button>
        {rename.renaming ? (
          <RenameInput rename={rename} label={`Rename ${node.name}`} />
        ) : (
          <button
            type="button"
            class="tree-folder-button"
            title={node.path}
            onClick={() => props.onToggle(node.path)}
            onDblClick={rename.start}
          >
            <span class="tree-icon">
              <Icon name={isOpen ? 'folder-open' : 'folder'} size={16} />
            </span>
            <TreeName name={node.name} />
          </button>
        )}
        <RowActions
          node={node}
          isFolder
          onRename={props.onRename}
          onMove={props.onMove}
          onDelete={props.onDelete}
          onCreateFile={props.onCreateFile}
          onCreateFolder={props.onCreateFolder}
          onContextMenu={props.onContextMenu}
        />
      </div>
      {rename.error ? (
        <p class="tree-rename-error" role="alert">
          {rename.error}
        </p>
      ) : null}
      {isOpen ? (
        <ul class="tree-children">
          {folder.children.map((child) => (
            <TreeFolderRow
              key={child.node.path}
              folder={{ node: child.node, children: child.children }}
              filesByParent={props.filesByParent}
              currentPath={props.currentPath}
              expanded={props.expanded}
              depth={props.depth + 1}
              onToggle={props.onToggle}
              onSelect={props.onSelect}
              onCreateFolder={props.onCreateFolder}
              onCreateFile={props.onCreateFile}
              onRename={props.onRename}
              onMove={props.onMove}
              onDelete={props.onDelete}
              onContextMenu={props.onContextMenu}
              onRenameInline={props.onRenameInline}
              draggingPath={props.draggingPath}
              onDragStart={props.onDragStart}
              onDragEnd={props.onDragEnd}
              onDropOnFolder={props.onDropOnFolder}
            />
          ))}
          {files.map((file) => (
            <TreeNoteRow
              key={file.path}
              file={file}
              currentPath={props.currentPath}
              depth={props.depth + 1}
              onSelect={props.onSelect}
              onRename={props.onRename}
              onMove={props.onMove}
              onDelete={props.onDelete}
              onContextMenu={props.onContextMenu}
              onRenameInline={props.onRenameInline}
              draggingPath={props.draggingPath}
              onDragStart={props.onDragStart}
              onDragEnd={props.onDragEnd}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** A note of the tree. */
export function TreeNoteRow(props: TreeNoteRowProps) {
  const { file } = props;
  const selected = file.path === props.currentPath;
  const rename = useInlineRename(file, props.onRenameInline);
  const isDragging = props.draggingPath === file.path;

  const handleDragStart = (event: DragEvent): void => {
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', file.path);
      event.dataTransfer.effectAllowed = 'move';
    }
    props.onDragStart?.({ path: file.path, isFolder: false });
  };

  return (
    <li class={`tree-file${selected ? ' selected' : ''}`}>
      <div
        class={`tree-row${isDragging ? ' dragging' : ''}`}
        style={{ paddingLeft: `${indentOf(props.depth)}px` }}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={() => props.onDragEnd?.()}
      >
        {rename.renaming ? (
          <RenameInput rename={rename} label={`Rename ${file.name}`} />
        ) : (
          <button
            type="button"
            class="tree-file-button"
            title={file.path}
            aria-current={selected ? 'true' : undefined}
            onClick={() => props.onSelect(file.path)}
            onDblClick={rename.start}
          >
            <span class="tree-icon">
              <Icon name="file-text" size={16} />
            </span>
            <TreeName name={file.name} />
          </button>
        )}
        <RowActions
          node={file}
          isFolder={false}
          onRename={props.onRename}
          onMove={props.onMove}
          onDelete={props.onDelete}
          onContextMenu={props.onContextMenu}
        />
      </div>
      {rename.error ? (
        <p class="tree-rename-error" role="alert">
          {rename.error}
        </p>
      ) : null}
    </li>
  );
}
