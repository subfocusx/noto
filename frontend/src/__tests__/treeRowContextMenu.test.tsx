// The right click of a tree row and the header of the menu it opens.
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { TreeContextMenu } from '../components/TreeContextMenu';

/** The entries of the menu, in the order they are shown. */
function entriesOf(container: Element): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu-item'));
}

describe('the header of the context menu', () => {
  it('names the node the menu acts on', () => {
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

    const title = view.container.querySelector('.context-menu-title');
    expect(title?.textContent).toBe('2026');
  });

  it('names the note of the menu too', () => {
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

    const title = view.container.querySelector('.context-menu-title');
    expect(title?.textContent).toBe('a.md');
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
