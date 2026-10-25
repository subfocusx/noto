// The context menu of a row of the tree: its entries and its accessible name.
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { TreeContextMenu } from '../components/TreeContextMenu';

/** The entries of the menu, in the order they are shown. */
function entriesOf(container: Element): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu-item'));
}

describe('the context menu of a row', () => {
  it('does not show the name of the node', () => {
    const view = render(
      <TreeContextMenu
        path="journal/2026"
        isFolder
        x={10}
        y={10}
        onClose={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onCreateFile={() => undefined}
        onCreateFolder={() => undefined}
      />,
    );

    expect(view.container.querySelector('.context-menu-title')).toBeNull();
    expect(view.getByRole('menu').textContent).not.toContain('2026');
  });

  it('does not show the name of a note either', () => {
    const view = render(
      <TreeContextMenu
        path="journal/a.md"
        isFolder={false}
        x={10}
        y={10}
        onClose={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onCreateFile={() => undefined}
        onCreateFolder={() => undefined}
      />,
    );

    expect(view.container.querySelector('.context-menu-title')).toBeNull();
    expect(view.getByRole('menu').textContent).not.toContain('a.md');
  });

  it('holds nothing but the actions, so the panel stays narrow', () => {
    const view = render(
      <TreeContextMenu
        path="journal"
        isFolder
        x={10}
        y={10}
        onClose={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onCreateFile={() => undefined}
        onCreateFolder={() => undefined}
      />,
    );

    const menu = view.getByRole('menu');
    for (const child of Array.from(menu.children)) {
      expect(
        child.classList.contains('context-menu-item') ||
          child.classList.contains('context-menu-separator'),
      ).toBe(true);
    }
  });

  it('gives the menu the accessible name of its target', () => {
    const view = render(
      <TreeContextMenu
        path="journal"
        isFolder
        x={10}
        y={10}
        onClose={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onCreateFile={() => undefined}
        onCreateFolder={() => undefined}
      />,
    );

    const menu = view.getByRole('menu');
    expect(menu.getAttribute('aria-label')).toBe('Actions of journal');
  });

  it('names the note of the menu in its accessible name too', () => {
    const view = render(
      <TreeContextMenu
        path="journal/a.md"
        isFolder={false}
        x={10}
        y={10}
        onClose={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onCreateFile={() => undefined}
        onCreateFolder={() => undefined}
      />,
    );

    const menu = view.getByRole('menu');
    expect(menu.getAttribute('aria-label')).toBe('Actions of a.md');
  });

  it('still offers the creation of a note and of a folder inside a folder', () => {
    const onCreateFile = vi.fn();
    const onCreateFolder = vi.fn();
    const view = render(
      <TreeContextMenu
        path="journal"
        isFolder
        x={10}
        y={10}
        onClose={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onCreateFile={onCreateFile}
        onCreateFolder={onCreateFolder}
      />,
    );

    const labels = entriesOf(view.container).map((entry) => entry.getAttribute('aria-label'));
    expect(labels).toEqual(['Rename', 'Move', 'New note', 'New folder', 'Delete']);

    fireEvent.click(view.getByLabelText('New note'));
    expect(onCreateFile).toHaveBeenCalledTimes(1);
    expect(onCreateFolder).not.toHaveBeenCalled();
  });

  it('creates a folder inside the folder of the menu', () => {
    const onCreateFolder = vi.fn();
    const view = render(
      <TreeContextMenu
        path="journal"
        isFolder
        x={10}
        y={10}
        onClose={() => undefined}
        onRename={() => undefined}
        onMove={() => undefined}
        onDelete={() => undefined}
        onCreateFile={() => undefined}
        onCreateFolder={onCreateFolder}
      />,
    );

    fireEvent.click(view.getByLabelText('New folder'));

    expect(onCreateFolder).toHaveBeenCalledTimes(1);
  });
});
