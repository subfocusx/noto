import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import { MarkdownEditor, type EditorHandle } from '../components/Editor';

vi.mock('../api/attachments', () => ({
  uploadAttachment: vi.fn(async (file: File) => ({
    id: 'att-1',
    name: file.name,
    mime: file.type,
    size: file.size,
    createdAt: '2026-01-01T00:00:00Z',
  })),
  attachmentRawUrl: (id: string) => `/api/attachments/${id}/raw`,
}));

interface Setup {
  handle: EditorHandle | null;
}

function renderEditor(props: {
  value?: string;
  tags?: string[];
  highlightQuery?: string;
}) {
  const setup: Setup = { handle: null };
  const view = render(
    <MarkdownEditor
      value={props.value ?? ''}
      path="a.md"
      contentPath="a.md"
      tags={props.tags}
      highlightQuery={props.highlightQuery}
      onChange={() => undefined}
      onSave={() => undefined}
      onHandle={(handle) => {
        setup.handle = handle;
      }}
    />,
  );
  return { view, setup };
}

describe('the matches of the query in the editor', () => {
  it('paints every match of the query', () => {
    const { view } = renderEditor({ value: 'the cat and the cat', highlightQuery: 'cat' });
    const matches = view.container.querySelectorAll('.noto-match');
    expect(matches.length).toBe(2);
  });

  it('paints the current match stronger than the others', () => {
    const { view } = renderEditor({ value: 'the cat and the cat', highlightQuery: 'cat' });
    const current = view.container.querySelectorAll('.noto-match-current');
    expect(current.length).toBe(1);
  });

  it('paints nothing when there is no query', () => {
    const { view } = renderEditor({ value: 'the cat and the cat', highlightQuery: '' });
    expect(view.container.querySelectorAll('.noto-match').length).toBe(0);
  });
});

describe('the completion of the tags in the editor', () => {
  it('offers the tags of the vault while the user types a hash', async () => {
    const { view, setup } = renderEditor({ tags: ['work', 'workshop', 'home'] });
    setup.handle?.setText('a #wor');
    setup.handle?.insertAt('', 6, 6);

    await vi.waitFor(() => {
      const items = view.container.querySelectorAll('.editor-completion-item');
      expect(items.length).toBe(2);
    });
    const items = view.container.querySelectorAll('.editor-completion-item');
    expect(items[0]?.textContent).toBe('#work');
  });

  it('puts the chosen tag into the text', async () => {
    const { view, setup } = renderEditor({ tags: ['work', 'workshop'] });
    setup.handle?.setText('a #wor');
    setup.handle?.insertAt('', 6, 6);

    await vi.waitFor(() => {
      expect(view.container.querySelector('.editor-completion-item')).toBeTruthy();
    });
    const item = view.container.querySelector('.editor-completion-item');
    fireEvent.mouseDown(item as Element);
    expect(setup.handle?.getText()).toBe('a #work ');
  });

  it('closes the list when the caret leaves the tag', async () => {
    const { view, setup } = renderEditor({ tags: ['work'] });
    setup.handle?.setText('a #wor');
    setup.handle?.insertAt('', 6, 6);
    await vi.waitFor(() => {
      expect(view.container.querySelectorAll('.editor-completion-item').length).toBe(1);
    });

    setup.handle?.insertAt('', 0, 0);
    await vi.waitFor(() => {
      expect(view.container.querySelectorAll('.editor-completion-item').length).toBe(0);
    });
  });

  it('offers nothing when the vault has no tag', async () => {
    const { view, setup } = renderEditor({ tags: [] });
    setup.handle?.setText('a #wor');
    setup.handle?.insertAt('', 6, 6);
    await vi.waitFor(() => {
      expect(view.container.querySelectorAll('.editor-completion-item').length).toBe(0);
    });
  });

  it('puts the tag into the text with the Enter key', async () => {
    const { view, setup } = renderEditor({ tags: ['work'] });
    setup.handle?.setText('a #wor');
    setup.handle?.insertAt('', 6, 6);
    await vi.waitFor(() => {
      expect(view.container.querySelectorAll('.editor-completion-item').length).toBe(1);
    });

    const content = view.container.querySelector('.cm-content');
    fireEvent.keyDown(content as Element, { key: 'Enter', code: 'Enter', bubbles: true });
    expect(setup.handle?.getText()).toBe('a #work ');
  });
});

describe('the file that is dropped into the editor', () => {
  it('puts a reference of the file into the text', async () => {
    const { setup } = renderEditor({ value: 'hello' });
    const file = new File(['data'], 'photo.png', { type: 'image/png' });

    fireEvent.drop(document.querySelector('.editor-shell') as Element, {
      dataTransfer: { files: [file], types: ['Files'] },
    });

    await vi.waitFor(() => {
      expect(setup.handle?.getText()).toContain('![photo.png](/api/attachments/att-1/raw)');
    });
  });
});
