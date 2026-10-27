import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { TreeFolderRow, TreeNoteRow } from '../components/TreeRow';
import type { TreeFolder } from '../lib/tree';
import { buildTree, displayNameOf } from '../lib/tree';
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

/** The text the user reads: the hidden parts of a row do not count. */
function visibleText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return (clone.textContent ?? '').trim();
}

describe('displayNameOf', () => {
  it('removes the final .md of a note', () => {
    expect(displayNameOf('a.md')).toBe('a');
    expect(displayNameOf('notes.md')).toBe('notes');
  });

  it('does not care about the case of the extension', () => {
    expect(displayNameOf('A.MD')).toBe('A');
    expect(displayNameOf('a.Md')).toBe('a');
  });

  it('leaves the other extensions alone', () => {
    expect(displayNameOf('a.txt')).toBe('a.txt');
    expect(displayNameOf('a.mdx')).toBe('a.mdx');
  });

  it('leaves a name without extension alone', () => {
    expect(displayNameOf('a')).toBe('a');
    expect(displayNameOf('')).toBe('');
  });

  it('removes only the final extension', () => {
    expect(displayNameOf('a.md.md')).toBe('a.md');
    expect(displayNameOf('a.md.txt')).toBe('a.md.txt');
  });
});

describe('the name of a note in the tree', () => {
  it('shows the name of a note without its .md', () => {
    const view = render(
      <TreeNoteRow
        file={file('journal/a.md', 'a.md', 'journal')}
        currentPath=""
        depth={0}
        onSelect={() => undefined}
      />,
    );

    const label = view.container.querySelector('.tree-file-label .tree-name') as HTMLElement;
    expect(visibleText(label)).toBe('a');
    expect(visibleText(label)).not.toContain('.md');
  });

  it('keeps the full name of the note in the title of the button', () => {
    const view = render(
      <TreeNoteRow
        file={file('journal/a.md', 'a.md', 'journal')}
        currentPath=""
        depth={0}
        onSelect={() => undefined}
      />,
    );

    const button = view.container.querySelector('.tree-file-button') as HTMLButtonElement;
    expect(button.getAttribute('title')).toContain('a.md');
  });

  it('keeps the full name of the note in the label of the pin', () => {
    const view = render(
      <TreeNoteRow
        file={file('journal/a.md', 'a.md', 'journal')}
        currentPath=""
        depth={0}
        onSelect={() => undefined}
      />,
    );

    const pin = view.container.querySelector('.tree-pin button') as HTMLButtonElement;
    expect(pin.getAttribute('aria-label')).toContain('a.md');
  });

  it('keeps the full name of the note in the field of the rename', () => {
    const view = render(
      <TreeNoteRow
        file={file('journal/a.md', 'a.md', 'journal')}
        currentPath=""
        depth={0}
        onSelect={() => undefined}
        onRenameInline={() => undefined}
      />,
    );

    fireEvent.dblClick(view.container.querySelector('.tree-file-button') as HTMLElement);

    const input = view.container.querySelector('.tree-rename-input') as HTMLInputElement;
    expect(input.value).toBe('a.md');
  });

  it('sends the full name to the server when the note is renamed', () => {
    const onRenameInline = vi.fn();
    const view = render(
      <TreeNoteRow
        file={file('journal/a.md', 'a.md', 'journal')}
        currentPath=""
        depth={0}
        onSelect={() => undefined}
        onRenameInline={onRenameInline}
      />,
    );

    fireEvent.dblClick(view.container.querySelector('.tree-file-button') as HTMLElement);

    const input = view.container.querySelector('.tree-rename-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'b.md' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameInline).toHaveBeenCalledTimes(1);
    const [node, name] = onRenameInline.mock.calls[0] as [Node, string];
    expect(node.path).toBe('journal/a.md');
    expect(name).toBe('b.md');
  });
});

describe('the name of a folder in the tree', () => {
  it('shows the name of a folder unchanged', () => {
    const folders = [folder('notes.md', 'notes.md', '')];
    const files = [file('notes.md/a.md', 'a.md', 'notes.md')];
    const { roots, filesByParent } = buildTree(folders, files);

    const view = render(
      <TreeFolderRow
        folder={roots[0] as TreeFolder}
        filesByParent={filesByParent}
        currentPath=""
        expanded={new Set(['notes.md'])}
        depth={0}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onRenameInline={() => undefined}
      />,
    );

    const folderName = view.container.querySelector('.tree-folder-button .tree-name') as HTMLElement;
    expect(folderName.textContent).toBe('notes.md');
    expect(visibleText(folderName)).toBe('notes.md');
  });

  it('keeps the full name of a folder in the field of the rename', () => {
    const folders = [folder('notes.md', 'notes.md', '')];
    const { roots, filesByParent } = buildTree(folders, []);

    const view = render(
      <TreeFolderRow
        folder={roots[0] as TreeFolder}
        filesByParent={filesByParent}
        currentPath=""
        expanded={new Set<string>()}
        depth={0}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onRenameInline={() => undefined}
      />,
    );

    fireEvent.dblClick(view.container.querySelector('.tree-folder-button') as HTMLElement);

    const input = view.container.querySelector('.tree-rename-input') as HTMLInputElement;
    expect(input.value).toBe('notes.md');
  });
});
