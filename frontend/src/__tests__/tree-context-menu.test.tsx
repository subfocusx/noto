import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { TreeContextMenu } from '../components/TreeContextMenu';

interface Handlers {
  onClose: ReturnType<typeof vi.fn>;
  onRename: ReturnType<typeof vi.fn>;
  onMove: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onCreateFile: ReturnType<typeof vi.fn>;
  onCreateFolder: ReturnType<typeof vi.fn>;
  onDuplicate: ReturnType<typeof vi.fn>;
}

function handlers(): Handlers {
  return {
    onClose: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
    onCreateFile: vi.fn(),
    onCreateFolder: vi.fn(),
    onDuplicate: vi.fn(),
  };
}

/** The entries of the menu, in the order they are shown. */
function entriesOf(container: Element): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu-item'));
}

describe('the context menu of the tree', () => {
  it('shows icon-only entries, each with a label and a tooltip', () => {
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

    const entries = entriesOf(view.container);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.getAttribute('role')).toBe('menuitem');
      expect(entry.getAttribute('aria-label')).toBeTruthy();
      expect(entry.getAttribute('title')).toBeTruthy();
      // The entry is an icon: it does not repeat its name as text.
      expect(entry.textContent?.trim()).toBe('');
      expect(entry.querySelector('svg')).not.toBeNull();
    }
  });

  it('names the entries of the menu of a note', () => {
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

    const labels = entriesOf(view.container).map((entry) => entry.getAttribute('aria-label'));
    expect(labels).toEqual(['Rename', 'Move', 'Delete']);
    expect(view.getByLabelText('Rename').getAttribute('title')).toBe('Rename');
    expect(view.getByLabelText('Delete').getAttribute('title')).toBe('Delete');
  });

  it('shows the creation actions of a folder and no duplicate', () => {
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
        onDuplicate={() => undefined}
      />,
    );

    const labels = entriesOf(view.container).map((entry) => entry.getAttribute('aria-label'));
    expect(labels).toEqual(['Rename', 'Move', 'New note', 'New folder', 'Delete']);
    expect(view.queryByLabelText('Duplicate')).toBeNull();
  });

  it('shows the duplicate action of a note only when it is handled', () => {
    const calls = handlers();
    const view = render(
      <TreeContextMenu
        path="journal/a.md"
        isFolder={false}
        x={10}
        y={10}
        onClose={calls.onClose}
        onRename={calls.onRename}
        onMove={calls.onMove}
        onDelete={calls.onDelete}
        onCreateFile={calls.onCreateFile}
        onCreateFolder={calls.onCreateFolder}
        onDuplicate={calls.onDuplicate}
      />,
    );

    const duplicate = view.getByLabelText('Duplicate');
    expect(duplicate.getAttribute('title')).toBe('Duplicate');
    expect(duplicate.getAttribute('role')).toBe('menuitem');

    fireEvent.click(duplicate);
    expect(calls.onDuplicate).toHaveBeenCalledTimes(1);
    expect(calls.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the danger class on the delete entry', () => {
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

    expect(view.getByLabelText('Delete').className).toContain('danger');
    expect(view.getByLabelText('Rename').className).not.toContain('danger');
  });

  it('runs the chosen action and closes the menu', () => {
    const calls = handlers();
    const view = render(
      <TreeContextMenu
        path="journal/a.md"
        isFolder={false}
        x={10}
        y={10}
        onClose={calls.onClose}
        onRename={calls.onRename}
        onMove={calls.onMove}
        onDelete={calls.onDelete}
        onCreateFile={calls.onCreateFile}
        onCreateFolder={calls.onCreateFolder}
      />,
    );

    fireEvent.click(view.getByLabelText('Rename'));
    expect(calls.onRename).toHaveBeenCalledTimes(1);
    expect(calls.onClose).toHaveBeenCalledTimes(1);
  });
});
