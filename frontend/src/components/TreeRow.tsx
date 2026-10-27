// The rows of the tree.
//
// A row is a line of the file tree: a folder with its toggle, its name and
// its actions, or a note with its name and its actions. Both rows can be
// renamed in place with a double click, both rows can be dragged to another
// folder, and a right click on a row opens the menu of that row: the actions
// of a folder include the creation of a folder inside it.
//
// A note that the user marked as a favorite carries a small star next to its
// name: the mark is visible in the tree, not only in the section of the
// favorites.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useT } from '../i18n/useT';
import { useAppSelector } from '../core/store/hooks';
import type { Node } from '../types';
import type { TreeFolder } from '../lib/tree';
import type { MoveRefusal } from '../lib/tree';
import { refusalOfMove } from '../lib/tree';
import { displayNameOf } from '../lib/tree';
import { useOverflowTitle } from '../lib/useOverflowTitle';
import { formatDate } from '../lib/format';
import { Icon } from '../ui/icons';
import { NotePinButton } from './NotePinButton';
import type { TreeContextMenuPayload } from './TreeContextMenu';
import '../styles/tree-pins.css';
import '../styles/tree-dates.css';

/** The width of one indentation step, in pixels. */
const INDENT_STEP = 16;

/** The width of the column that holds the chevron of a row, in pixels. */
const RAIL_WIDTH = 16;

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
  onContextMenu?(payload: TreeContextMenuPayload): void;
  onRenameInline?(node: Node, name: string): void | Promise<void>;
  /** The node that is currently dragged, if any. */
  draggingNode?: Node | null;
  /** Called when a drag starts. */
  onDragStart?(state: TreeDragState): void;
  /** Called when a drag ends. */
  onDragEnd?(): void;
  /** Called when a node is dropped on a folder. */
  onDropOnFolder?(node: Node, targetParentPath: string): void;
  /**
   * Called when the pointer is over the row, with the reason the drop would
   * be refused (and null when the row accepts the node).
   */
  onRefuse?(refusal: MoveRefusal | null): void;
  /** The number of notes inside the folder, counted recursively. */
  noteCount?: number;
  /** The number of notes of every folder, by path. */
  noteCountsByPath?: Map<string, number>;
}

export interface TreeNoteRowProps {
  /** The note of the row. */
  file: Node;
  /** The path of the note that is open. */
  currentPath: string;
  /** The depth of the row in the tree. */
  depth: number;
  onSelect(path: string): void;
  onContextMenu?(payload: TreeContextMenuPayload): void;
  onRenameInline?(node: Node, name: string): void | Promise<void>;
  /** The node that is currently dragged, if any. */
  draggingNode?: Node | null;
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
export function indentOf(depth: number): number {
  return depth * INDENT_STEP;
}

/**
 * The vertical lines that show the ancestors of a row.
 *
 * Every level of the tree gets its own line, so the nesting is readable and
 * not only felt through the indentation.
 */
function IndentGuides(props: { depth: number }) {
  if (props.depth <= 0) return null;
  return (
    <span class="tree-indent-guides" aria-hidden="true">
      {Array.from({ length: props.depth }, (_, level) => (
        <span
          key={level}
          class="tree-indent-guide"
          style={{ left: `${level * INDENT_STEP + INDENT_STEP / 2}px` }}
        />
      ))}
    </span>
  );
}

/**
 * Checks a new name.
 *
 * Returns the key of the message of the error, or null when the name is valid.
 */
function validateName(name: string): string | null {
  if (name.length === 0) return 'tree.nameEmpty';
  if (name.includes('/') || name.includes('\\')) {
    return 'tree.nameSlash';
  }
  if (/[\u0000-\u001f]/.test(name)) {
    return 'tree.nameControl';
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

/**
 * Tells whether a native event happened inside the rename field of a row.
 *
 * The user who renames a node is editing a name, not asking for a menu: the
 * right click inside the field must not open the menu of the row.
 */
function isInsideRenameInput(event: Event, rename: InlineRename): boolean {
  if (!rename.renaming) return false;
  return event.target === rename.inputRef.current;
}

/**
 * Opens the menu of a row after a native right click.
 *
 * The browser menu never appears in the tree: the right click is one of the
 * ways to reach the actions of a row, and the actions of a folder include the
 * creation of a folder inside it.
 */
function openMenuOnRightClick(
  event: JSX.TargetedMouseEvent<HTMLDivElement>,
  node: Node,
  isFolder: boolean,
  rename: InlineRename,
  onContextMenu?: (payload: TreeContextMenuPayload) => void,
): void {
  event.preventDefault();
  if (isInsideRenameInput(event, rename)) return;
  onContextMenu?.({
    path: node.path,
    isFolder,
    x: event.clientX,
    y: event.clientY,
  });
}

/**
 * The actions of a row.
 *
 * The row carries one button: the menu of the row. Every action of the row
 * lives in that menu, so the row stays narrow and the actions are never shown
 * twice.
 */
function RowActions(props: {
  node: Node;
  onContextMenu?(payload: TreeContextMenuPayload): void;
}) {
  const t = useT();
  const { node } = props;
  if (!props.onContextMenu) return null;
  return (
    <span class="tree-actions">
      <button
        type="button"
        class="icon-button"
        title={t('tree.menuButton', { name: node.name })}
        aria-label={t('tree.menuButton', { name: node.name })}
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
    </span>
  );
}

/**
 * A part of a name that the user does not read.
 *
 * The tree shows the name of a note without its `.md` extension, but the
 * full name stays in the page: the tools that read the tree must not lose
 * it, and the row keeps it for them.
 */
function HiddenPart(props: { text: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        margin: '-1px',
        padding: '0',
        border: '0',
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
      }}
    >
      {props.text}
    </span>
  );
}

/**
 * The name of a row, cut off with an ellipsis when it does not fit.
 *
 * `fullName` is the complete name of a note: the row shows it without its
 * extension and keeps the rest of it out of sight.
 */
function TreeName(props: { name: string; fullName?: string }) {
  const overflow = useOverflowTitle(props.name);
  const hidden = props.fullName && props.fullName !== props.name
    ? props.fullName.slice(props.name.length)
    : '';
  return (
    <span class="tree-name" ref={overflow.ref} title={overflow.title}>
      {props.name}
      {hidden ? <HiddenPart text={hidden} /> : null}
    </span>
  );
}

/** A folder of the tree, with its children. */
export function TreeFolderRow(props: TreeFolderRowProps) {
  const t = useT();
  const { folder } = props;
  const node = folder.node;
  const isOpen = props.expanded.has(node.path);
  const files = props.filesByParent.get(node.path) ?? [];
  const rename = useInlineRename(node, props.onRenameInline);
  const [over, setOver] = useState(false);
  const isDragging = props.draggingNode?.path === node.path;
  const count = props.noteCountsByPath?.get(node.path) ?? props.noteCount ?? 0;
  // The drop is only possible when the move is not refused: the row tells the
  // user so before the drop, instead of refusing it afterwards.
  const refusal = props.draggingNode ? refusalOfMove(props.draggingNode, node.path) : null;
  const canDrop = refusal === null;

  // The highlight of a drop target disappears with the drag itself.
  useEffect(() => {
    if (!props.draggingNode) setOver(false);
  }, [props.draggingNode]);

  const handleDragStart = (event: DragEvent): void => {
    // The user who renames a node is selecting a text, not dragging a row.
    if (isInsideRenameInput(event, rename)) {
      event.preventDefault();
      return;
    }
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', node.path);
      event.dataTransfer.effectAllowed = 'move';
    }
    props.onDragStart?.({ path: node.path, isFolder: true });
  };

  const handleDragOver = (event: DragEvent): void => {
    event.preventDefault();
    // The cursor tells the truth: a refused target does not look like a
    // target.
    props.onRefuse?.(refusal);
    if (event.dataTransfer) event.dataTransfer.dropEffect = canDrop ? 'move' : 'none';
    setOver(true);
  };

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault();
    // The row answers for itself: the tree must not read the same drop as a
    // drop that landed nowhere.
    event.stopPropagation();
    setOver(false);
    props.onDropOnFolder?.(node, node.path);
  };

  const handleContextMenu = (event: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    openMenuOnRightClick(event, node, true, rename, props.onContextMenu);
  };

  return (
    <li class="tree-folder">
      <div
        class={`tree-row${isDragging ? ' dragging' : ''}${over ? ' drop-target' : ''}${
          over && !canDrop ? ' drop-refused' : ''
        }`}
        data-tree-path={node.path}
        data-tree-kind="folder"
        style={{ paddingLeft: `${indentOf(props.depth)}px` }}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={() => props.onDragEnd?.()}
        onDragOver={handleDragOver}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}
      >
        <IndentGuides depth={props.depth} />
        <span class="tree-rail" style={{ width: `${RAIL_WIDTH}px` }}>
          <button
            type="button"
            class="tree-toggle"
            aria-expanded={isOpen}
            aria-label={isOpen ? t('tree.collapse', { name: node.name }) : t('tree.expand', { name: node.name })}
            title={isOpen ? t('tree.collapse', { name: node.name }) : t('tree.expand', { name: node.name })}
            onClick={() => props.onToggle(node.path)}
          >
            <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
          </button>
        </span>
        {rename.renaming ? (
          <RenameInput rename={rename} label={t('tree.renameLabel', { name: node.name })} />
        ) : (
          <button
            type="button"
            class="tree-folder-button"
            title={node.path}
            onClick={() => props.onToggle(node.path)}
            onDblClick={rename.start}
            onKeyDown={(event) => {
              // F2 renames the row that has the focus, like in every file
              // manager. The event is not passed further: the tree would
              // read F2 as a letter of the quick jump.
              if (event.key !== 'F2') return;
              event.preventDefault();
              event.stopPropagation();
              rename.start();
            }}
          >
            <span class="tree-icon">
              <Icon name={isOpen ? 'folder-open' : 'folder'} size={14} />
            </span>
            <TreeName name={node.name} />
          </button>
        )}
        {over ? (
          <span class={`tree-drop-badge${canDrop ? '' : ' refused'}`}>
            <Icon name={canDrop ? 'move' : 'x'} size={12} />
            {canDrop ? t('tree.dropHere') : t('tree.cannotDropHere')}
          </span>
        ) : null}
        {count > 0 ? <span class="tree-count">{count}</span> : null}
        <RowActions node={node} onContextMenu={props.onContextMenu} />
      </div>
      {rename.error ? (
        <p class="tree-rename-error" role="alert">
          {t(rename.error)}
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
              onContextMenu={props.onContextMenu}
              onRenameInline={props.onRenameInline}
              draggingNode={props.draggingNode}
              onDragStart={props.onDragStart}
              onDragEnd={props.onDragEnd}
              onDropOnFolder={props.onDropOnFolder}
              noteCount={props.noteCountsByPath?.get(child.node.path)}
              noteCountsByPath={props.noteCountsByPath}
            />
          ))}
          {files.map((file) => (
            <TreeNoteRow
              key={file.path}
              file={file}
              currentPath={props.currentPath}
              depth={props.depth + 1}
              onSelect={props.onSelect}
              onContextMenu={props.onContextMenu}
              onRenameInline={props.onRenameInline}
              draggingNode={props.draggingNode}
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
  const t = useT();
  const { file } = props;
  const selected = file.path === props.currentPath;
  const rename = useInlineRename(file, props.onRenameInline);
  const isDragging = props.draggingNode?.path === file.path;
  // The list of the favorites lives in the store: the row reads it there, so
  // the star of a note appears and disappears without a new property in the
  // props of the rows. The subscription is narrow: the row is redrawn when
  // its own star changes, not on every keystroke of the editor.
  const favorite = useAppSelector((state) => state.ui.favorites.includes(file.path));
  // The moment the note was written: the row shows it when the pointer rests
  // on it, so that the date does not crowd the tree.
  const created = formatDate(file.createdAt);

  const handleDragStart = (event: DragEvent): void => {
    // The user who renames a node is selecting a text, not dragging a row.
    if (isInsideRenameInput(event, rename)) {
      event.preventDefault();
      return;
    }
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', file.path);
      event.dataTransfer.effectAllowed = 'move';
    }
    props.onDragStart?.({ path: file.path, isFolder: false });
  };

  const handleContextMenu = (event: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    openMenuOnRightClick(event, file, false, rename, props.onContextMenu);
  };

  return (
    <li class={`tree-file${selected ? ' selected' : ''}`}>
      <div
        class={`tree-row${isDragging ? ' dragging' : ''}`}
        data-tree-path={file.path}
        data-tree-kind="note"
        style={{ paddingLeft: `${indentOf(props.depth)}px` }}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={() => props.onDragEnd?.()}
        onContextMenu={handleContextMenu}
      >
        <IndentGuides depth={props.depth} />
        <span class="tree-rail" style={{ width: `${RAIL_WIDTH}px` }} />
        {rename.renaming ? (
          <RenameInput rename={rename} label={t('tree.renameLabel', { name: file.name })} />
        ) : (
          <button
            type="button"
            class="tree-file-button"
            title={file.path}
            aria-label={file.name}
            aria-current={selected ? 'true' : undefined}
            onClick={() => props.onSelect(file.path)}
            onDblClick={rename.start}
            onKeyDown={(event) => {
              // F2 renames the row that has the focus, like in every file
              // manager. The event is not passed further: the tree would
              // read F2 as a letter of the quick jump.
              if (event.key !== 'F2') return;
              event.preventDefault();
              event.stopPropagation();
              rename.start();
            }}
          >
            <span class="tree-icon tree-icon-empty" aria-hidden="true" />
            <span class="tree-file-label">
              <TreeName name={displayNameOf(file.name)} fullName={file.name} />
              <HiddenPart text={file.name} />
              {favorite ? (
                <span class="tree-favorite" aria-hidden="true">
                  <Icon name="star" size={12} />
                </span>
              ) : null}
            </span>
          </button>
        )}
        {created ? (
          <span class="tree-created" title={t('tree.created', { date: created })}>
            {created}
          </span>
        ) : null}
        <span class="tree-pin">
          <NotePinButton path={file.path} label={file.name} />
        </span>
        <RowActions node={file} onContextMenu={props.onContextMenu} />
      </div>
      {rename.error ? (
        <p class="tree-rename-error" role="alert">
          {t(rename.error)}
        </p>
      ) : null}
    </li>
  );
}
