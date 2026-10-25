import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { ICONS } from '../ui/icons';

/** The shape of a deleted note, as the API returns it. */
interface TrashEntry {
  id: string;
  name: string;
  path: string;
  type: 'file';
  parentPath: string;
  size: number;
  modTime: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** The answer of the list of the trash. */
interface TrashAnswer {
  entries: TrashEntry[];
}

// The list of the trash is tested against its two seams: the client of the API
// (the list itself and the restore) and the store (the action of the restore).
// Nothing else is touched.
const api = vi.hoisted(() => {
  const entries: TrashEntry[] = [
    {
      id: 'trash/a.md',
      name: 'a.md',
      path: 'trash/a.md',
      type: 'file' as const,
      parentPath: 'trash',
      size: 3,
      modTime: '',
      revision: 1,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'trash/b.md',
      name: 'b.md',
      path: 'trash/b.md',
      type: 'file' as const,
      parentPath: 'trash',
      size: 3,
      modTime: '',
      revision: 1,
      createdAt: '',
      updatedAt: '',
    },
  ];
  return {
    entries,
    getTrash: vi.fn(async (): Promise<TrashAnswer> => ({ entries })),
    restoreNote: vi.fn(async (_trashPath: string) => ({ id: 'trash/a.md' })),
  };
});

const store = vi.hoisted(() => ({
  // The action of the store reaches the server through the client of the API.
  restoreFromTrash: vi.fn(async (path: string) => api.restoreNote(path)),
}));

vi.mock('../api/client', () => api);
vi.mock('../core/store/appStore', () => ({
  appStore: { actions: { restoreFromTrash: store.restoreFromTrash } },
}));

import { TrashList } from '../components/TrashList';

/** The paths that draw an icon of the registry. */
function registryPaths(): string[] {
  const RegistryIcon = ICONS['rotate-ccw'];
  const { container } = render(<RegistryIcon />);
  return Array.from(container.querySelectorAll('path')).map((path) => path.getAttribute('d') ?? '');
}

/** The paths that draw the icon of a button. */
function drawnPaths(button: Element): string[] {
  return Array.from(button.querySelectorAll('path')).map((path) => path.getAttribute('d') ?? '');
}

describe('the list of the trash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Each test starts from a trash that holds two notes; the tests that need
    // another answer replace it for a single call.
    api.getTrash.mockReset();
    api.getTrash.mockResolvedValue({ entries: api.entries });
    api.restoreNote.mockReset();
    api.restoreNote.mockResolvedValue({ id: 'trash/a.md' });
  });

  it('restores a note with an icon button, not with a text button', async () => {
    render(<TrashList />);
    await waitFor(() => expect(screen.getByTestId('trash-list')).toBeTruthy());

    // The action of a row is an icon: there is no "Restore" text any more.
    expect(screen.queryByText('Restore')).toBeNull();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.className).toContain('icon-button');
    }

    // Every row names its own note, so the screen reader tells them apart.
    expect(screen.getByLabelText('Restore a.md')).toBeTruthy();
    expect(screen.getByLabelText('Restore b.md')).toBeTruthy();
  });

  it('restores the note of the pressed row', async () => {
    const onRestored = vi.fn();
    render(<TrashList onRestored={onRestored} />);
    await waitFor(() => expect(screen.getByTestId('trash-list')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Restore b.md'));

    await waitFor(() => expect(store.restoreFromTrash).toHaveBeenCalledWith('trash/b.md'));
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
  });

  it('draws the icon of the registry in the restore button', async () => {
    render(<TrashList />);
    await waitFor(() => expect(screen.getByTestId('trash-list')).toBeTruthy());

    // The button shows the very drawing of the icon it names: the paths of the
    // registry are the paths of the button.
    const expected = registryPaths();
    expect(expected.length).toBeGreaterThan(0);

    for (const name of ['Restore a.md', 'Restore b.md']) {
      const button = screen.getByLabelText(name);
      expect(drawnPaths(button)).toEqual(expected);
    }
  });

  it('names the restore button after the note and shows no text', async () => {
    render(<TrashList />);
    await waitFor(() => expect(screen.getByTestId('trash-list')).toBeTruthy());

    // The accessible name of the button is the name of the action and of the
    // file; the button itself stays without a visible text.
    const button = screen.getByRole('button', { name: 'Restore a.md' });
    expect(button.getAttribute('aria-label')).toBe('Restore a.md');
    expect(button.textContent).toBe('');
  });

  it('says that the trash is empty', async () => {
    api.getTrash.mockResolvedValueOnce({ entries: [] });

    render(<TrashList />);

    await waitFor(() => expect(api.getTrash).toHaveBeenCalled());
    // The list is loaded: the waiting state is over and the trash holds nothing.
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.getByText('The trash is empty.')).toBeTruthy();
    expect(screen.getByTestId('trash-list').children).toHaveLength(0);
  });

  it('waits for the trash of the server', async () => {
    // The answer of the server is late: the list waits for it.
    let answer: (value: TrashAnswer) => void = () => undefined;
    const pending = new Promise<TrashAnswer>((resolve) => {
      answer = resolve;
    });
    api.getTrash.mockImplementationOnce(() => pending);

    render(<TrashList />);

    await waitFor(() => expect(screen.getByText('Loading…')).toBeTruthy());
    // The empty state does not replace the waiting state.
    expect(screen.queryByText('The trash is empty.')).toBeNull();

    answer({ entries: [] });
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  });

  it('shows the error of a refused load', async () => {
    api.getTrash.mockRejectedValueOnce(new Error('the trash is closed'));

    const { container } = render(<TrashList />);

    await waitFor(() => expect(container.querySelector('.error-text')).toBeTruthy());
    expect(container.querySelector('.error-text')?.textContent).toBe('the trash is closed');
    // A refused load does not mean that the trash is empty: the two states
    // must never be shown together.
    expect(screen.queryByText('The trash is empty.')).toBeNull();
  });

  it('shows the error of a refused restore and restores nothing', async () => {
    api.restoreNote.mockRejectedValueOnce(new Error('the note is gone'));
    const onRestored = vi.fn();

    const { container } = render(<TrashList onRestored={onRestored} />);
    await waitFor(() => expect(screen.getByTestId('trash-list')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Restore a.md'));

    await waitFor(() => expect(container.querySelector('.error-text')).toBeTruthy());
    expect(container.querySelector('.error-text')?.textContent).toBe('the note is gone');
    // The note was not restored, so the caller is not told that it was.
    expect(onRestored).not.toHaveBeenCalled();
  });
});
