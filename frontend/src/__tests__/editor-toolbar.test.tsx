// The tests of the toolbar of the editor.
//
// The toolbar puts the Markdown syntax around the selection of the editor,
// so the tests watch the edit that it sends to the editor.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import { appStore } from '../core/store/appStore';
import { EditorToolbar } from '../components/EditorToolbar';
import type { EditorHandle } from '../components/Editor';

/** The editor of the test: a text and a selection. */
function fakeHandle(text = 'hello', from = 0, to = text.length) {
  return {
    getText: () => text,
    getCursor: () => ({ from, to }),
    applyEdit: vi.fn(),
    focus: vi.fn(),
  } as unknown as EditorHandle;
}

afterEach(() => {
  appStore.reset();
});

describe('the toolbar of the editor', () => {
  it('puts the Markdown around the selection', () => {
    const handle = fakeHandle('hello world', 0, 5);
    const view = render(<EditorToolbar handle={handle} />);

    fireEvent.click(view.getByRole('button', { name: 'Bold' }));

    expect(handle.applyEdit).toHaveBeenCalledTimes(1);
    const edit = (handle.applyEdit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(edit.text).toBe('**hello** world');
  });

  it('makes a heading of the line of the selection', () => {
    const handle = fakeHandle('title', 0, 5);
    const view = render(<EditorToolbar handle={handle} />);

    fireEvent.click(view.getByRole('button', { name: 'Heading of the first level' }));

    const edit = (handle.applyEdit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(edit.text).toBe('# title');
  });

  it('changes the size of the font of the editor', () => {
    const view = render(<EditorToolbar handle={fakeHandle()} />);

    fireEvent.click(view.getByRole('button', { name: 'Bigger font' }));
    expect(appStore.getSnapshot().ui.editorFontSize).toBe(15);

    fireEvent.click(view.getByRole('button', { name: 'Smaller font' }));
    expect(appStore.getSnapshot().ui.editorFontSize).toBe(14);
  });

  it('keeps the buttons of the text disabled without an editor', () => {
    const view = render(<EditorToolbar handle={null} />);

    expect((view.getByRole('button', { name: 'Bold' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
