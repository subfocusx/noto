// The quick file switcher: the dialog that jumps to a note by its name.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/preact';
import { FileSwitcher, type SwitcherFile } from '../components/FileSwitcher';

/** The notes of the storage used by the tests. */
const FILES: SwitcherFile[] = [
  { path: 'Projects/Noto/Roadmap.md', name: 'Roadmap.md' },
  { path: 'Projects/Noto/Notes.md', name: 'Notes.md' },
  { path: 'Journal/2024-01-05.md', name: '2024-01-05.md' },
  { path: 'Ideas.md', name: 'Ideas.md' },
];

describe('the quick file switcher', () => {
  it('shows a dialog with a focused field and the list of the notes', async () => {
    const view = render(
      <FileSwitcher open files={FILES} onOpen={() => {}} onClose={() => {}} />,
    );

    const dialog = await waitFor(() => view.getByRole('dialog', { name: 'Quick file switcher' }));
    expect(dialog).toBeTruthy();

    const input = view.getByRole('combobox');
    await waitFor(() => expect(document.activeElement).toBe(input));

    const options = view.getAllByRole('option');
    expect(options).toHaveLength(4);

    view.unmount();
  });

  it('filters the notes by the name, ignoring the case', async () => {
    const view = render(
      <FileSwitcher open files={FILES} onOpen={() => {}} onClose={() => {}} />,
    );

    const input = await waitFor(() => view.getByRole('combobox'));
    fireEvent.input(input, { target: { value: 'ROAD' } });

    const options = view.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent ?? '').toContain('Roadmap.md');

    view.unmount();
  });

  it('filters the notes by the path', async () => {
    const view = render(
      <FileSwitcher open files={FILES} onOpen={() => {}} onClose={() => {}} />,
    );

    const input = await waitFor(() => view.getByRole('combobox'));
    fireEvent.input(input, { target: { value: 'journal' } });

    const options = view.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent ?? '').toContain('2024-01-05.md');

    view.unmount();
  });

  it('opens the note of the active option when Enter is pressed', async () => {
    const onOpen = vi.fn();
    const view = render(
      <FileSwitcher open files={FILES} onOpen={onOpen} onClose={() => {}} />,
    );

    const input = await waitFor(() => view.getByRole('combobox'));
    fireEvent.input(input, { target: { value: 'notes' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onOpen).toHaveBeenCalledWith('Projects/Noto/Notes.md');

    view.unmount();
  });

  it('moves the active option with the arrows', async () => {
    const onOpen = vi.fn();
    const view = render(
      <FileSwitcher open files={FILES} onOpen={onOpen} onClose={() => {}} />,
    );

    const input = await waitFor(() => view.getByRole('combobox'));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The list is sorted by name: `2024-01-05.md`, `Ideas.md`, `Notes.md`,
    // `Roadmap.md`.
    expect(onOpen).toHaveBeenCalledWith('Ideas.md');

    view.unmount();
  });

  it('closes when Escape is pressed', async () => {
    const onClose = vi.fn();
    const view = render(
      <FileSwitcher open files={FILES} onOpen={() => {}} onClose={onClose} />,
    );

    const input = await waitFor(() => view.getByRole('combobox'));
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();

    view.unmount();
  });

  it('shows the empty state when nothing matches', async () => {
    const view = render(
      <FileSwitcher open files={FILES} onOpen={() => {}} onClose={() => {}} />,
    );

    const input = await waitFor(() => view.getByRole('combobox'));
    fireEvent.input(input, { target: { value: 'zzz-not-a-note' } });

    await waitFor(() => expect(view.getByText('No matching note')).toBeTruthy());
    expect(view.queryAllByRole('option')).toHaveLength(0);

    view.unmount();
  });

  it('does not steal the global combinations', async () => {
    const onClose = vi.fn();
    const view = render(
      <FileSwitcher open files={FILES} onOpen={() => {}} onClose={onClose} />,
    );

    const input = await waitFor(() => view.getByRole('combobox'));
    fireEvent.keyDown(input, { key: 'p', ctrlKey: true });

    expect(onClose).not.toHaveBeenCalled();

    view.unmount();
  });
});
