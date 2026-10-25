import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { Sidebar } from '../components/Sidebar';
import { TreeFolderRow, TreeNoteRow, indentOf } from '../components/TreeRow';
import type { TreeDragState } from '../components/TreeRow';
import type { TreeContextMenuPayload } from '../components/TreeContextMenu';
import { buildTree } from '../lib/tree';
import type { TreeFolder } from '../lib/tree';
import type { Node } from '../types';

function file(path: string, name: string, parentPath: string): Node {
  return {
    id: path,
    name,
    path,
    type: 'file',
    parentPath,
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

function folder(path: string, name: string, parentPath: string): Node {
  return {
    id: path,
    name,
    path,
    type: 'folder',
    parentPath,
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

describe('tree building', () => {
  it('nests folders and groups files by parent', () => {
    const folders = [folder('journal', 'journal', ''), folder('journal/2026', '2026', 'journal')];
    const files = [
      file('root.md', 'root.md', ''),
      file('journal/a.md', 'a.md', 'journal'),
      file('journal/2026/b.md', 'b.md', 'journal/2026'),
    ];
    const { roots, filesByParent } = buildTree(folders, files);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.node.name).toBe('journal');
    expect(roots[0]?.children[0]?.node.name).toBe('2026');
    expect(filesByParent.get('')?.map((f) => f.name)).toEqual(['root.md']);
    expect(filesByParent.get('journal')?.map((f) => f.name)).toEqual(['a.md']);
    expect(filesByParent.get('journal/2026')?.map((f) => f.name)).toEqual(['b.md']);
  });

  it('sorts every level of the tree by name', () => {
    const folders = [
      folder('journal', 'journal', ''),
      folder('journal/2026', '2026', 'journal'),
      folder('journal/archive', 'archive', 'journal'),
      folder('zeta', 'zeta', ''),
    ];
    const { roots } = buildTree(folders, []);
    expect(roots.map((r) => r.node.name)).toEqual(['journal', 'zeta']);
    expect(roots[0]?.children.map((c) => c.node.name)).toEqual(['2026', 'archive']);
  });
});

describe('sidebar navigation', () => {
  it('selects a file and toggles folders', () => {
    const folders = [folder('journal', 'journal', '')];
    const files = [file('journal/a.md', 'a.md', 'journal')];
    const { roots, filesByParent } = buildTree(folders, files);
    const onSelect = vi.fn();
    const onToggle = vi.fn();

    const view = render(
      <Sidebar
        section="explorer"
        folders={roots}
        filesByParent={filesByParent}
        currentPath="journal/a.md"
        expanded={new Set(['journal'])}
        onToggle={onToggle}
        onSelect={onSelect}
        onCreateFolder={() => undefined}
        onCreateFile={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onOpenTransfer={() => undefined}
        onRefresh={() => undefined}
        loading={false}
      />,
    );

    fireEvent.click(view.getByText('a.md'));
    expect(onSelect).toHaveBeenCalledWith('journal/a.md');

    fireEvent.click(view.getByLabelText('Collapse journal'));
    expect(onToggle).toHaveBeenCalledWith('journal');
  });

  it('hides the files of a collapsed folder', () => {
    const folders = [folder('journal', 'journal', '')];
    const files = [file('journal/a.md', 'a.md', 'journal')];
    const { roots, filesByParent } = buildTree(folders, files);
    const view = render(
      <Sidebar
        section="explorer"
        folders={roots}
        filesByParent={filesByParent}
        currentPath=""
        expanded={new Set<string>()}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onCreateFolder={() => undefined}
        onCreateFile={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onOpenTransfer={() => undefined}
        onRefresh={() => undefined}
        loading={false}
      />,
    );
    expect(view.queryByText('a.md')).toBeNull();
  });
});

describe('the rows of the tree', () => {
  /** A tree of three levels: journal / 2026 / march, with a note. */
  function nestedTree(): {
    folder: TreeFolder;
    filesByParent: Map<string, Node[]>;
  } {
    const folders = [
      folder('journal', 'journal', ''),
      folder('journal/2026', '2026', 'journal'),
      folder('journal/2026/march', 'march', 'journal/2026'),
    ];
    const files = [file('journal/2026/march/a.md', 'a.md', 'journal/2026/march')];
    const { roots, filesByParent } = buildTree(folders, files);
    return { folder: roots[0] as TreeFolder, filesByParent };
  }

  function renderTree(props: {
    depth?: number;
    expanded?: string[];
    noteCount?: number;
    noteCountsByPath?: Map<string, number>;
  }) {
    const { folder: root, filesByParent } = nestedTree();
    return render(
      <TreeFolderRow
        folder={root}
        filesByParent={filesByParent}
        currentPath=""
        expanded={new Set(props.expanded ?? [])}
        depth={props.depth ?? 0}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onContextMenu={() => undefined}
        noteCount={props.noteCount}
        noteCountsByPath={props.noteCountsByPath}
      />,
    );
  }

  it('indents every level by the same step', () => {
    expect(indentOf(0)).toBe(0);
    expect(indentOf(1)).toBe(16);
    expect(indentOf(3)).toBe(48);
  });

  it('draws a guide for every ancestor of a row', () => {
    const view = renderTree({
      expanded: ['journal', 'journal/2026', 'journal/2026/march'],
    });

    const top = view.getByText('journal').closest('.tree-row') as HTMLElement;
    expect(top.style.paddingLeft).toBe('0px');
    expect(top.querySelector('.tree-indent-guides')).toBeNull();

    const middle = view.getByText('2026').closest('.tree-row') as HTMLElement;
    expect(middle.style.paddingLeft).toBe('16px');
    expect(middle.querySelectorAll('.tree-indent-guide')).toHaveLength(1);

    const deep = view.getByText('march').closest('.tree-row') as HTMLElement;
    expect(deep.style.paddingLeft).toBe('32px');
    expect(deep.querySelectorAll('.tree-indent-guide')).toHaveLength(2);

    const note = view.getByText('a.md').closest('.tree-row') as HTMLElement;
    expect(note.style.paddingLeft).toBe('48px');
    expect(note.querySelectorAll('.tree-indent-guide')).toHaveLength(3);
  });

  it('gives every row a rail for its chevron', () => {
    const view = renderTree({
      expanded: ['journal', 'journal/2026', 'journal/2026/march'],
    });
    const rows = view.container.querySelectorAll('.tree-row');
    expect(rows).toHaveLength(4);
    for (const row of Array.from(rows)) {
      expect(row.querySelector('.tree-rail')).not.toBeNull();
    }
  });

  it('shows the number of notes of a folder only when it is not empty', () => {
    const empty = renderTree({ noteCount: 0 });
    expect(empty.container.querySelector('.tree-count')).toBeNull();
    empty.unmount();

    const filled = renderTree({ noteCount: 5 });
    const count = filled.container.querySelector('.tree-count');
    expect(count?.textContent).toBe('5');
    filled.unmount();

    const byPath = renderTree({ noteCountsByPath: new Map([['journal', 3]]) });
    expect(byPath.container.querySelector('.tree-count')?.textContent).toBe('3');
  });

  it('keeps one action per row: the menu of the row', () => {
    const view = renderTree({});
    const actions = view.container.querySelectorAll('.tree-actions .icon-button');
    expect(actions.length).toBeGreaterThan(0);
    for (const action of Array.from(actions)) {
      const button = action as HTMLButtonElement;
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.getAttribute('title')).toBeTruthy();
      expect(button.textContent?.trim()).toBe('');
    }
  });

  it('shows no action of its own when the row has no menu', () => {
    const { folder: root, filesByParent } = nestedTree();
    const view = render(
      <TreeFolderRow
        folder={root}
        filesByParent={filesByParent}
        currentPath=""
        expanded={new Set<string>()}
        depth={0}
        onToggle={() => undefined}
        onSelect={() => undefined}
      />,
    );

    expect(view.container.querySelector('.tree-actions')).toBeNull();
  });

  it('marks the open note as selected', () => {
    const { folder: root, filesByParent } = nestedTree();
    const view = render(
      <TreeNoteRow
        file={file('journal/2026/march/a.md', 'a.md', 'journal/2026/march')}
        currentPath="journal/2026/march/a.md"
        depth={2}
        onSelect={() => undefined}
      />,
    );

    expect(view.container.querySelector('.tree-file.selected')).not.toBeNull();
    expect(view.container.querySelector('.tree-rail')).not.toBeNull();
    expect(filesByParent.size).toBeGreaterThan(0);
    expect(root.node.name).toBe('journal');
  });
});

describe('the right click on a row', () => {
  /** The tree of the tests: the folder `journal` and the note `a.md` inside it. */
  function renderTree(onContextMenu: (payload: TreeContextMenuPayload) => void) {
    const folders = [folder('journal', 'journal', '')];
    const files = [file('journal/a.md', 'a.md', 'journal')];
    const { roots, filesByParent } = buildTree(folders, files);
    return render(
      <TreeFolderRow
        folder={roots[0] as TreeFolder}
        filesByParent={filesByParent}
        currentPath=""
        expanded={new Set(['journal'])}
        depth={0}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onContextMenu={onContextMenu}
        onRenameInline={() => undefined}
      />,
    );
  }

  it('opens the menu of a folder at the pointer of the right click', () => {
    const onContextMenu = vi.fn();
    const view = renderTree(onContextMenu);
    const row = view.getByText('journal').closest('.tree-row') as HTMLElement;

    fireEvent.contextMenu(row, { clientX: 120, clientY: 240 });

    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu).toHaveBeenCalledWith({
      path: 'journal',
      isFolder: true,
      x: 120,
      y: 240,
    });
  });

  it('opens the menu of a note when the right click lands on it', () => {
    const onContextMenu = vi.fn();
    const view = renderTree(onContextMenu);
    const row = view.getByText('a.md').closest('.tree-row') as HTMLElement;

    fireEvent.contextMenu(row, { clientX: 30, clientY: 40 });

    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu).toHaveBeenCalledWith({
      path: 'journal/a.md',
      isFolder: false,
      x: 30,
      y: 40,
    });
  });

  it('does not open the menu when the right click lands in the rename field', () => {
    const onContextMenu = vi.fn();
    const view = renderTree(onContextMenu);
    fireEvent.dblClick(view.getByText('journal'));
    const input = view.getByLabelText('Rename journal');

    fireEvent.contextMenu(input, { clientX: 10, clientY: 20 });

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it('keeps the button of the menu of the row working', () => {
    const onContextMenu = vi.fn();
    const view = renderTree(onContextMenu);

    fireEvent.click(view.getByLabelText('Menu journal'));

    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0]?.[0]).toMatchObject({
      path: 'journal',
      isFolder: true,
    });
  });
});

describe('the drag and the drop of the tree', () => {
  /** The data transfer of a drag: it remembers what the row puts into it. */
  function dataTransferMock() {
    return {
      setData: vi.fn(),
      getData: vi.fn(),
      clearData: vi.fn(),
      setDragImage: vi.fn(),
      effectAllowed: '',
      dropEffect: '',
      types: [] as string[],
      files: [] as unknown[],
      items: [] as unknown[],
    };
  }

  /** The tree of the tests: the folder `journal`, its subfolder `archive` and
   * the note `a.md` inside `archive`. */
  function renderTree(props: {
    onDragStart?: (state: TreeDragState) => void;
    onDragEnd?: () => void;
    onDropOnFolder?: (node: Node, targetParentPath: string) => void;
    draggingNode?: Node | null;
  }) {
    const folders = [
      folder('journal', 'journal', ''),
      folder('journal/archive', 'archive', 'journal'),
    ];
    const files = [file('journal/archive/a.md', 'a.md', 'journal/archive')];
    const { roots, filesByParent } = buildTree(folders, files);
    const root = roots.find((entry) => entry.node.path === 'journal') as TreeFolder;
    return render(
      <TreeFolderRow
        folder={root}
        filesByParent={filesByParent}
        currentPath=""
        expanded={new Set(['journal', 'journal/archive'])}
        depth={0}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onContextMenu={() => undefined}
        onRenameInline={() => undefined}
        draggingNode={props.draggingNode ?? null}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        onDropOnFolder={props.onDropOnFolder}
      />,
    );
  }

  it('starts the drag of a note with the path of the note', () => {
    const onDragStart = vi.fn();
    const dataTransfer = dataTransferMock();
    const view = renderTree({ onDragStart });

    fireEvent.dragStart(view.getByText('a.md').closest('.tree-row') as HTMLElement, { dataTransfer });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragStart).toHaveBeenCalledWith({ path: 'journal/archive/a.md', isFolder: false });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'journal/archive/a.md');
  });

  it('drops a node on a folder', () => {
    const onDropOnFolder = vi.fn();
    const view = renderTree({ onDropOnFolder });
    const row = view.getByText('journal').closest('.tree-row') as HTMLElement;

    fireEvent.drop(row, { dataTransfer: dataTransferMock() });

    expect(onDropOnFolder).toHaveBeenCalledTimes(1);
    const [node, targetParentPath] = onDropOnFolder.mock.calls[0] as [Node, string];
    expect(node.path).toBe('journal');
    expect(targetParentPath).toBe('journal');
  });

  it('shows the folder as the target of the drop', () => {
    const view = renderTree({
      draggingNode: file('journal/archive/a.md', 'a.md', 'journal/archive'),
    });
    const row = view.getByText('journal').closest('.tree-row') as HTMLElement;

    fireEvent.dragOver(row, { dataTransfer: dataTransferMock() });

    expect(row.classList.contains('drop-target')).toBe(true);
    expect(row.classList.contains('drop-refused')).toBe(false);
    expect(view.getByText('Drop here')).toBeTruthy();
  });

  it('says that the drop is refused when the move is impossible', () => {
    const view = renderTree({ draggingNode: folder('journal', 'journal', '') });
    const row = view.getByText('journal').closest('.tree-row') as HTMLElement;

    fireEvent.dragOver(row, { dataTransfer: dataTransferMock() });

    expect(row.classList.contains('drop-target')).toBe(true);
    expect(row.classList.contains('drop-refused')).toBe(true);
    expect(view.getByText('Cannot drop here')).toBeTruthy();
  });

  it('says that the drop is refused when the note is already in the folder', () => {
    const view = renderTree({
      draggingNode: file('journal/archive/a.md', 'a.md', 'journal/archive'),
    });
    const row = view.getByText('archive').closest('.tree-row') as HTMLElement;

    fireEvent.dragOver(row, { dataTransfer: dataTransferMock() });

    expect(row.classList.contains('drop-refused')).toBe(true);
    expect(view.getByText('Cannot drop here')).toBeTruthy();
  });

  it('tells the cursor the truth: a refused target does not look like a target', () => {
    const refused = dataTransferMock();
    const view = renderTree({ draggingNode: folder('journal', 'journal', '') });

    fireEvent.dragOver(view.getByText('journal').closest('.tree-row') as HTMLElement, {
      dataTransfer: refused,
    });

    expect(refused.dropEffect).toBe('none');
  });

  it('lets the cursor move a node into a folder that accepts it', () => {
    const accepted = dataTransferMock();
    const view = renderTree({
      draggingNode: file('journal/archive/a.md', 'a.md', 'journal/archive'),
    });

    fireEvent.dragOver(view.getByText('journal').closest('.tree-row') as HTMLElement, {
      dataTransfer: accepted,
    });

    expect(accepted.dropEffect).toBe('move');
  });

  it('does not drag a row while its name is being renamed', () => {
    const onDragStart = vi.fn();
    const view = renderTree({ onDragStart });
    fireEvent.dblClick(view.getByText('journal'));
    const input = view.getByLabelText('Rename journal');

    fireEvent.dragStart(input, { dataTransfer: dataTransferMock() });

    expect(onDragStart).not.toHaveBeenCalled();
  });
});

describe('the drag and the drop of the explorer', () => {
  /** The data transfer of a drag: it remembers what the row puts into it. */
  function dataTransferMock() {
    return {
      setData: vi.fn(),
      getData: vi.fn(),
      clearData: vi.fn(),
      setDragImage: vi.fn(),
      effectAllowed: '',
      dropEffect: '',
      types: [] as string[],
      files: [] as unknown[],
      items: [] as unknown[],
    };
  }

  /** The explorer of the tests: the folders `journal` and `archive`. */
  function renderExplorer(onMoveNode?: (node: Node, targetParentPath: string) => void) {
    const folders = [folder('journal', 'journal', ''), folder('archive', 'archive', '')];
    const files = [file('journal/a.md', 'a.md', 'journal')];
    const { roots, filesByParent } = buildTree(folders, files);
    return render(
      <Sidebar
        section="explorer"
        folders={roots}
        filesByParent={filesByParent}
        currentPath=""
        expanded={new Set(['journal'])}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onCreateFolder={() => undefined}
        onCreateFile={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onOpenTransfer={() => undefined}
        onRefresh={() => undefined}
        onMoveNode={onMoveNode}
        loading={false}
      />,
    );
  }

  it('tells the user that a note is moved by dropping it on a folder', () => {
    const view = renderExplorer();

    expect(view.getByText('Drag a note onto a folder to move it.')).toBeTruthy();
  });

  it('moves a folder into another folder when it is dropped on it', async () => {
    const onMoveNode = vi.fn();
    const view = renderExplorer(onMoveNode);

    fireEvent.dragStart(view.getByText('journal').closest('.tree-row') as HTMLElement, {
      dataTransfer: dataTransferMock(),
    });
    // The explorer shows the zone of the root as soon as the drag starts.
    await waitFor(() => expect(view.getByText('Move to the root')).toBeTruthy());

    fireEvent.drop(view.getByText('archive').closest('.tree-row') as HTMLElement, {
      dataTransfer: dataTransferMock(),
    });

    await waitFor(() => expect(onMoveNode).toHaveBeenCalledTimes(1));
    expect(onMoveNode.mock.calls[0]?.[0]).toMatchObject({ path: 'journal', type: 'folder' });
    expect(onMoveNode.mock.calls[0]?.[1]).toBe('archive');
  });

  it('refuses to move a folder into itself and says why', async () => {
    const onMoveNode = vi.fn();
    const view = renderExplorer(onMoveNode);

    fireEvent.dragStart(view.getByText('journal').closest('.tree-row') as HTMLElement, {
      dataTransfer: dataTransferMock(),
    });
    await waitFor(() => expect(view.getByText('Move to the root')).toBeTruthy());

    fireEvent.drop(view.getByText('journal').closest('.tree-row') as HTMLElement, {
      dataTransfer: dataTransferMock(),
    });

    await waitFor(() =>
      expect(view.getByText('A folder cannot be moved into itself.')).toBeTruthy(),
    );
    expect(onMoveNode).not.toHaveBeenCalled();
  });

  it('keeps the tree in place when the drag starts', async () => {
    const view = renderExplorer();

    fireEvent.dragStart(view.getByText('journal').closest('.tree-row') as HTMLElement, {
      dataTransfer: dataTransferMock(),
    });
    await waitFor(() => expect(view.getByText('Move to the root')).toBeTruthy());

    // The target of the root comes after the tree: a row that appears while
    // the user drags would push the tree away under the pointer.
    const tree = view.getByTestId('file-tree');
    const root = view.getByText('Move to the root');
    expect(
      tree.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
