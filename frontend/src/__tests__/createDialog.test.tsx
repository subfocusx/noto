// The tests of the dialogs of the notes.
//
// The dialog of the creation and of the renaming used to show the warning
// about an empty name as soon as it was opened: the user saw an error before
// having typed anything. These tests guard the fix: the warning appears only
// after the user has emptied the field.
import { describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { NoteDialogs } from '../components/NoteDialogs';
import type { DialogState } from '../core/store/types';

/** The handlers the shell gives to the dialogs. */
interface Handlers {
  onChangeValue: Mock<[string], void>;
  onConfirm: Mock<[], void>;
}

/**
 * The dialogs with the name in the state.
 *
 * The shell holds the value of the dialog; the harness does the same, so the
 * field of the name behaves as it behaves in the application.
 */
function Dialogs(props: { initial: DialogState; handlers: Handlers }) {
  const [dialog, setDialog] = useState(props.initial);
  return (
    <NoteDialogs
      dialog={dialog}
      folderPaths={['journal']}
      draftOffer={null}
      onClose={() => undefined}
      onConfirm={props.handlers.onConfirm}
      onChangeValue={(value) => {
        props.handlers.onChangeValue(value);
        setDialog((current) => ({ ...current, value }));
      }}
      onRestoreDraft={() => undefined}
      onDiscardDraft={() => undefined}
    />
  );
}

/** Renders the dialogs with the given state. */
function renderDialogs(initial: DialogState) {
  const handlers: Handlers = {
    onChangeValue: vi.fn<[string], void>(),
    onConfirm: vi.fn<[], void>(),
  };
  const view = render(<Dialogs initial={initial} handlers={handlers} />);
  return { ...view, handlers };
}

/** The field of the name of the dialog. */
function nameField(): HTMLInputElement {
  return screen.getByLabelText('Name') as HTMLInputElement;
}

describe('the dialog of a new folder', () => {
  it('opens with an empty name and the placeholder of a folder', () => {
    renderDialogs({ kind: 'create-folder' });

    expect(screen.getByRole('dialog', { name: 'New folder' })).toBeTruthy();

    const input = nameField();
    expect(input.value).toBe('');
    expect(input.getAttribute('placeholder')).toBe('Folder name');
  });
});

describe('the dialog of a new note', () => {
  it('opens with an empty name and the placeholder of a note', () => {
    renderDialogs({ kind: 'create-file' });

    expect(screen.getByRole('dialog', { name: 'New note' })).toBeTruthy();

    const input = nameField();
    expect(input.value).toBe('');
    expect(input.getAttribute('placeholder')).toBe('Note name');
  });
});

describe('the dialog of the renaming', () => {
  it('shows the real name of the note', () => {
    renderDialogs({ kind: 'rename', value: 'Old name' });

    expect(screen.getByRole('dialog', { name: 'Rename' })).toBeTruthy();

    const input = nameField();
    expect(input.value).toBe('Old name');
    expect(input.getAttribute('placeholder')).toBe('Name');
  });
});

describe('the warning about an empty name', () => {
  it('is not shown when the dialog has just been opened', () => {
    renderDialogs({ kind: 'create-folder' });

    expect(screen.queryByText('The name must not be empty.')).toBeNull();
    expect(nameField().getAttribute('aria-invalid')).toBeNull();
  });

  it('appears when the user empties the field', () => {
    renderDialogs({ kind: 'create-folder' });

    const input = nameField();
    fireEvent.input(input, { target: { value: 'journal' } });
    fireEvent.input(input, { target: { value: '' } });

    expect(screen.getByText('The name must not be empty.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('reports the name the user types', () => {
    const { handlers } = renderDialogs({ kind: 'create-folder' });

    fireEvent.input(nameField(), { target: { value: 'journal' } });

    expect(handlers.onChangeValue).toHaveBeenCalledWith('journal');
  });
});

describe('the confirmation of the dialog', () => {
  it('calls the confirmation when the user presses OK', () => {
    const { handlers } = renderDialogs({ kind: 'create-folder' });

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
  });
});
