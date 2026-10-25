import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';

// The list of the trash is tested against its two seams: the client of the API
// (the list itself) and the store (the restore). Nothing else is touched.
const api = vi.hoisted(() => ({
  getTrash: vi.fn(async () => ({
    entries: [
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
    ],
  })),
}));

const store = vi.hoisted(() => ({
  restoreFromTrash: vi.fn(async () => ({})),
}));

vi.mock('../api/client', () => api);
vi.mock('../core/store/appStore', () => ({
  appStore: { actions: { restoreFromTrash: store.restoreFromTrash } },
}));

import { TrashList } from '../components/TrashList';

describe('the list of the trash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
