import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { MarkdownEditor, type EditorHandle } from '../components/Editor';

interface Setup {
  handle: EditorHandle | null;
}

function renderEditor(setup: Setup, props: {
  value: string;
  path: string;
  contentPath?: string | null;
}) {
  return render(
    <MarkdownEditor
      value={props.value}
      path={props.path}
      contentPath={props.contentPath ?? props.path}
      onChange={() => undefined}
      onSave={() => undefined}
      onHandle={(handle) => {
        setup.handle = handle;
      }}
    />,
  );
}

describe('markdown editor', () => {
  it('keeps a single editor instance and releases the state of the previous note', () => {
    const setup: Setup = { handle: null };
    const view = renderEditor(setup, { value: 'first note', path: 'a.md' });

    expect(view.container.querySelectorAll('.cm-editor').length).toBe(1);
    // The markdown mode is loaded eagerly, the other language modes are lazy.
    expect(view.container.querySelector('[data-language="markdown"]')).toBeTruthy();
    expect(setup.handle?.getText()).toBe('first note');

    view.rerender(
      <MarkdownEditor
        value="second note"
        path="b.md"
        contentPath="b.md"
        onChange={() => undefined}
        onSave={() => undefined}
        onHandle={(handle) => {
          setup.handle = handle;
        }}
      />,
    );

    // Still one editor, the document of the new note is shown.
    expect(view.container.querySelectorAll('.cm-editor').length).toBe(1);
    expect(setup.handle?.getText()).toBe('second note');
  });

  it('ignores the content of another note', () => {
    const setup: Setup = { handle: null };
    const view = renderEditor(setup, { value: 'first note', path: 'a.md' });

    view.rerender(
      <MarkdownEditor
        value="first note"
        path="b.md"
        contentPath="a.md"
        onChange={() => undefined}
        onSave={() => undefined}
        onHandle={(handle) => {
          setup.handle = handle;
        }}
      />,
    );

    // The value belongs to another note, so it must not be shown.
    expect(setup.handle?.getText()).toBe('');
  });
});
