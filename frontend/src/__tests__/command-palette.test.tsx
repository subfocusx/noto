import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/preact';
import { App } from '../App';
import { CommandPalette } from '../components/CommandPalette';
import { CommandRegistry } from '../core/commands/commandRegistry';
import { appStore } from '../core/store/appStore';
import { dailyNoteName } from '../core/store/actions';

/** The tree the mocked backend reports. */
const tree = { folders: [] as unknown[], files: [] as unknown[] };

const createFileMock = vi.fn(async (_parentPath: string, name: string) => {
  tree.files.push({ path: name, name, type: 'file' });
  return { path: name, name, type: 'file' };
});

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  getTree: vi.fn(async () => ({ folders: tree.folders, files: tree.files })),
  getNote: vi.fn(async (path: string) => ({
    path,
    content: '# hello',
    revision: 1,
    updatedAt: new Date(0).toISOString(),
    conflict: false,
  })),
  saveNote: vi.fn(async (path: string) => ({ path, revision: 2, updatedAt: '' })),
  createFolder: vi.fn(async () => ({})),
  createFile: (...args: [string, string]) => createFileMock(...args),
  renameNote: vi.fn(async () => ({})),
  moveNote: vi.fn(async () => ({})),
  deleteNote: vi.fn(async () => ({ ok: true })),
  search: vi.fn(async () => []),
  listAttachments: vi.fn(async () => []),
  getTrash: vi.fn(async () => ({ entries: [] })),
  restoreNote: vi.fn(async () => ({})),
  importFiles: vi.fn(async () => ({ imported: [], skipped: [], errors: [] })),
  importZip: vi.fn(async () => ({ imported: [], skipped: [], errors: [] })),
  uploadAttachment: vi.fn(async () => ({})),
  deleteAttachment: vi.fn(async () => ({ ok: true })),
  exportNoteUrl: (path: string) => `/api/export/note?path=${path}`,
  exportFolderUrl: (path: string) => `/api/export/folder?path=${path}`,
  exportAllUrl: () => '/api/export/all',
  attachmentRawUrl: (id: string) => `/api/attachments/${id}/raw`,
}));

beforeEach(() => {
  tree.folders = [];
  tree.files = [];
  createFileMock.mockClear();
});

/** Waits until the tree of the store is loaded. */
async function waitForTree(): Promise<void> {
  await waitFor(() => expect(appStore.getSnapshot().tree.loading).toBe(false));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('the command palette', () => {
  it('opens with Ctrl+K and lists the commands of the application', async () => {
    const view = render(<App />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    const dialog = await waitFor(() => view.getByRole('dialog', { name: 'Command palette' }));
    expect(dialog).toBeTruthy();

    const options = view.getAllByRole('option').map((option) => option.textContent ?? '');
    expect(options.some((text) => text.includes('New note'))).toBe(true);
    expect(options.some((text) => text.includes('New folder'))).toBe(true);
    expect(options.some((text) => text.includes('Rename note'))).toBe(true);
    expect(options.some((text) => text.includes('Delete note'))).toBe(true);
    expect(options.some((text) => text.includes('Daily note'))).toBe(true);
    expect(options.some((text) => text.includes('Search notes'))).toBe(true);
    expect(options.some((text) => text.includes('Open trash'))).toBe(true);
    expect(options.some((text) => text.includes('Toggle theme'))).toBe(true);

    view.unmount();
  });

  it('opens with Ctrl+P as well', async () => {
    const view = render(<App />);

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });

    await waitFor(() => expect(view.getByRole('dialog', { name: 'Command palette' })).toBeTruthy());

    view.unmount();
  });

  it('moves the focus into the field and back to the trigger', async () => {
    const view = render(<App />);

    const trigger = view.getByRole('button', { name: 'Open command palette' });
    trigger.focus();
    fireEvent.click(trigger);

    const input = await waitFor(() => view.getByLabelText('Search commands'));
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(document.activeElement).toBe(trigger));

    view.unmount();
  });

  it('filters the commands by a substring, ignoring the case', async () => {
    const view = render(<App />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await waitFor(() => view.getByLabelText('Search commands'));

    fireEvent.input(input, { target: { value: 'DAILY' } });

    const options = view.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('Daily note');

    view.unmount();
  });

  it('runs the selected command with Enter', async () => {
    const view = render(<App />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await waitFor(() => view.getByLabelText('Search commands'));

    fireEvent.input(input, { target: { value: 'new note' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The command opened the dialog of a new note.
    await waitFor(() => expect(view.getByRole('dialog', { name: 'New note' })).toBeTruthy());
    // The palette is closed.
    expect(view.queryByRole('dialog', { name: 'Command palette' })).toBeNull();

    view.unmount();
  });

  it('closes with Escape', async () => {
    const view = render(<App />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await waitFor(() => view.getByLabelText('Search commands'));

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() =>
      expect(view.queryByRole('dialog', { name: 'Command palette' })).toBeNull(),
    );

    view.unmount();
  });

  it('shows the commands of the plugins', () => {
    const registry = new CommandRegistry();
    registry.register('demo-plugin', {
      id: 'demo-plugin:hello',
      title: 'Hello from the plugin',
      description: 'A command of a plugin',
      run: () => undefined,
    });

    const view = render(
      <CommandPalette open registry={registry} onClose={() => undefined} />,
    );

    expect(view.getByText('Hello from the plugin')).toBeTruthy();
    expect(view.getAllByRole('option')).toHaveLength(1);

    view.unmount();
  });

  it('runs a command of a plugin and survives a failing one', async () => {
    const registry = new CommandRegistry();
    const ran = vi.fn();
    registry.register('demo-plugin', {
      id: 'demo-plugin:hello',
      title: 'Hello from the plugin',
      run: ran,
    });
    registry.register('demo-plugin', {
      id: 'demo-plugin:broken',
      title: 'Broken command',
      run: () => {
        throw new Error('the command exploded');
      },
    });

    const onError = vi.fn();
    const view = render(
      <CommandPalette open registry={registry} onClose={() => undefined} onError={onError} />,
    );

    const input = view.getByLabelText('Search commands');
    fireEvent.input(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(ran).toHaveBeenCalledTimes(1);

    fireEvent.input(input, { target: { value: 'broken' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onError).toHaveBeenCalledWith('the command exploded'));
    expect(view.getByRole('alert').textContent).toContain('the command exploded');

    view.unmount();
  });
});

describe('the daily note', () => {
  it('creates the note of today and opens it', async () => {
    const view = render(<App />);
    const name = dailyNoteName();

    await waitForTree();
    await appStore.actions.openOrCreateDailyNote();

    expect(createFileMock).toHaveBeenCalledTimes(1);
    expect(createFileMock).toHaveBeenCalledWith('', name);
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/);
    await waitFor(() => expect(appStore.getSnapshot().note.path).toBe(name));

    view.unmount();
  });

  it('opens the existing note instead of overwriting it', async () => {
    const view = render(<App />);
    const name = dailyNoteName();

    await waitForTree();
    await appStore.actions.openOrCreateDailyNote();
    expect(createFileMock).toHaveBeenCalledTimes(1);

    await appStore.actions.openOrCreateDailyNote();

    // Nothing was created a second time.
    expect(createFileMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(appStore.getSnapshot().note.path).toBe(name));

    view.unmount();
  });

  it('reports a folder with the same name and changes nothing', async () => {
    const name = dailyNoteName();
    tree.folders = [{ path: name, name, type: 'folder' }];

    const view = render(<App />);

    await waitForTree();
    await appStore.actions.openOrCreateDailyNote();

    expect(createFileMock).not.toHaveBeenCalled();
    expect(appStore.getSnapshot().banner).toContain(name);

    view.unmount();
  });
});
