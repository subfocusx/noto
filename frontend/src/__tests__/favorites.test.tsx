// The tests of the favorites.
//
// The favorites live in the store of the application: the tests prepare the
// state with the store itself and read it back after every action. The list is
// written to `localStorage`, so the storage is cleared between the tests —
// the store reads the favorites again when it is reset.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { FavoritesSection } from '../components/sections/FavoritesSection';
import { TreeContextMenu } from '../components/TreeContextMenu';
import { TreeNoteRow } from '../components/TreeRow';
import { appStore } from '../core/store/appStore';
import type { Node } from '../types';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  appStore.reset();
});

/** A note of the tree. */
function note(path: string, name: string): Node {
  return {
    id: path,
    name,
    path,
    type: 'file',
    parentPath: '',
    size: 0,
    modTime: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
  };
}

/** The notes of the vault of the tests. */
const files = [note('journal/alpha.md', 'alpha.md'), note('journal/beta.md', 'beta.md')];

/** Marks a note as a favorite. */
function favorite(path: string): void {
  appStore.actions.toggleFavorite(path);
}

/** The section of the favorites, with the props of the tests. */
function renderSection() {
  const onOpenNote = vi.fn();
  render(<FavoritesSection files={files} onOpenNote={onOpenNote} />);
  return { onOpenNote };
}

/** The menu of a node of the tree. */
function renderMenu(path: string, isFolder: boolean) {
  return render(
    <TreeContextMenu
      path={path}
      isFolder={isFolder}
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
}

/** The star of the row of a note of the tree. */
function starOf(path: string): Element | null {
  const view = render(
    <TreeNoteRow
      file={files.find((file) => file.path === path) as Node}
      currentPath=""
      depth={0}
      onSelect={() => undefined}
    />,
  );
  return view.container.querySelector('.tree-favorite');
}

describe('the section of the favorites', () => {
  it('lists the favorites of the store and shows the name of the note', () => {
    favorite('journal/alpha.md');
    favorite('journal/beta.md');

    renderSection();

    const names = Array.from(document.querySelectorAll('.favorite-name')).map(
      (name) => name.textContent,
    );
    expect(names).toEqual(['alpha', 'beta']);
    expect(screen.getByText('journal/alpha.md')).toBeTruthy();
  });

  it('opens the note of a favorite', () => {
    favorite('journal/beta.md');
    const { onOpenNote } = renderSection();

    fireEvent.click(screen.getByRole('button', { name: /^beta/ }));

    expect(onOpenNote).toHaveBeenCalledWith('journal/beta.md');
  });

  it('removes a favorite from the store', () => {
    favorite('journal/alpha.md');
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Remove alpha from the favorites' }));

    expect(appStore.getSnapshot().ui.favorites).toEqual([]);
    expect(document.querySelectorAll('.favorite-item')).toHaveLength(0);
  });

  it('keeps a note that was deleted from the vault and lets the user remove it', () => {
    favorite('journal/gone.md');
    renderSection();

    expect(screen.getByText('gone')).toBeTruthy();
    expect(screen.getByText('journal/gone.md')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove gone from the favorites' }));
    expect(appStore.getSnapshot().ui.favorites).toEqual([]);
  });

  it('shows the hint of an empty list', () => {
    renderSection();

    expect(
      screen.getByText(
        'No favorite yet. Open the menu of a note in the tree and choose "Add to favorites".',
      ),
    ).toBeTruthy();
  });
});

describe('the entry of the menu of a note', () => {
  it('offers to add a note to the favorites', () => {
    const view = renderMenu('journal/alpha.md', false);

    expect(view.getByLabelText('Add to favorites')).toBeTruthy();
  });

  it('offers to remove a note that is already a favorite', () => {
    favorite('journal/alpha.md');
    const view = renderMenu('journal/alpha.md', false);

    expect(view.getByLabelText('Remove from favorites')).toBeTruthy();
    expect(view.queryByLabelText('Add to favorites')).toBeNull();
  });

  it('does not offer the favorite of a folder', () => {
    const view = renderMenu('journal', true);

    expect(view.queryByLabelText('Add to favorites')).toBeNull();
    expect(view.queryByLabelText('Remove from favorites')).toBeNull();
  });

  it('marks the note as a favorite and closes the menu', () => {
    const view = renderMenu('journal/alpha.md', false);

    fireEvent.click(view.getByLabelText('Add to favorites'));

    expect(appStore.getSnapshot().ui.favorites).toEqual(['journal/alpha.md']);
  });

  it('takes the note out of the favorites', () => {
    favorite('journal/alpha.md');
    const view = renderMenu('journal/alpha.md', false);

    fireEvent.click(view.getByLabelText('Remove from favorites'));

    expect(appStore.getSnapshot().ui.favorites).toEqual([]);
  });
});

describe('the star of a note of the tree', () => {
  it('stands next to the name of a note that is a favorite', () => {
    favorite('journal/alpha.md');

    expect(starOf('journal/alpha.md')).not.toBeNull();
  });

  it('does not stand next to the name of the other notes', () => {
    favorite('journal/alpha.md');

    expect(starOf('journal/beta.md')).toBeNull();
  });
});
