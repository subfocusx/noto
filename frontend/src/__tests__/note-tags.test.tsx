// Tests of the tags of the open note and of the dialog of a conflict.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import { NoteTags, normalizeTag } from '../components/NoteTags';
import { NoteConflictDialog } from '../components/NoteConflictDialog';
import type { NoteConflict } from '../core/store/types';

describe('the tags of the open note', () => {
  it('shows the tags of the text of the note', () => {
    const view = render(<NoteTags content="# Title\n\n#work #urgent" onAddTag={() => {}} onRemoveTag={() => {}} />);

    expect(view.getByText('#work')).toBeTruthy();
    expect(view.getByText('#urgent')).toBeTruthy();
  });

  it('shows the strip even when the note has no tags', () => {
    const view = render(<NoteTags content="# Title\n\nno tags here" onAddTag={() => {}} onRemoveTag={() => {}} />);

    // The strip carries the button that adds the first tag.
    expect(view.getByTestId('note-tags')).toBeTruthy();
    expect(view.getByLabelText('Add a tag to the note')).toBeTruthy();
  });

  it('adds a tag through the field', () => {
    const onAddTag = vi.fn();
    const view = render(<NoteTags content="#work" onAddTag={onAddTag} onRemoveTag={() => {}} />);

    fireEvent.click(view.getByLabelText('Add a tag to the note'));
    fireEvent.input(view.getByLabelText('Name of the new tag'), { target: { value: 'Idea' } });
    fireEvent.keyDown(view.getByLabelText('Name of the new tag'), { key: 'Enter' });

    expect(onAddTag).toHaveBeenCalledWith('idea');
  });

  it('adds the tag only once when the field is submitted twice', () => {
    const onAddTag = vi.fn();
    const view = render(<NoteTags content="" onAddTag={onAddTag} onRemoveTag={() => {}} />);

    fireEvent.click(view.getByLabelText('Add a tag to the note'));
    const field = view.getByLabelText('Name of the new tag');
    fireEvent.input(field, { target: { value: 'idea' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    // The field disappears and loses the focus: the second submission must not
    // add the tag a second time.
    fireEvent.blur(field);

    expect(onAddTag).toHaveBeenCalledTimes(1);
    expect(onAddTag).toHaveBeenCalledWith('idea');
  });

  it('does not add the same tag twice', () => {
    const onAddTag = vi.fn();
    const view = render(<NoteTags content="#work" onAddTag={onAddTag} onRemoveTag={() => {}} />);

    fireEvent.click(view.getByLabelText('Add a tag to the note'));
    fireEvent.input(view.getByLabelText('Name of the new tag'), { target: { value: 'work' } });
    fireEvent.keyDown(view.getByLabelText('Name of the new tag'), { key: 'Enter' });

    expect(onAddTag).not.toHaveBeenCalled();
  });

  it('removes a tag', () => {
    const onRemoveTag = vi.fn();
    const view = render(<NoteTags content="#work #urgent" onAddTag={() => {}} onRemoveTag={onRemoveTag} />);

    fireEvent.click(view.getByLabelText('Remove the tag work'));

    expect(onRemoveTag).toHaveBeenCalledWith('work');
  });

  it('normalises the name of a tag', () => {
    expect(normalizeTag('#Work')).toBe('work');
    expect(normalizeTag('  Work Idea ')).toBe('work-idea');
    expect(normalizeTag('project/alpha')).toBe('project/alpha');
    expect(normalizeTag('###')).toBe('');
  });
});

describe('the dialog of a conflict', () => {
  const conflict: NoteConflict = {
    path: 'a.md',
    serverContent: '# The server version',
    serverRevision: 7,
    serverUpdatedAt: '2026-01-02T03:04:05.000Z',
  };

  it('shows nothing when there is no conflict', () => {
    const view = render(
      <NoteConflictDialog
        conflict={null}
        localContent=""
        onReload={() => {}}
        onKeepMine={() => {}}
        onCopyMine={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(view.queryByTestId('note-conflict')).toBeNull();
  });

  it('offers the three ways out of the conflict', () => {
    const onReload = vi.fn();
    const onKeepMine = vi.fn();
    const onCopyMine = vi.fn();
    const view = render(
      <NoteConflictDialog
        conflict={conflict}
        localContent="# My version"
        onReload={onReload}
        onKeepMine={onKeepMine}
        onCopyMine={onCopyMine}
        onDismiss={() => {}}
      />,
    );

    expect(view.getByTestId('note-conflict')).toBeTruthy();
    expect(view.getByText(/changed elsewhere/)).toBeTruthy();

    fireEvent.click(view.getByText('Take the version of the server'));
    fireEvent.click(view.getByText('Keep my version'));
    fireEvent.click(view.getByText('Copy my version'));

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onKeepMine).toHaveBeenCalledTimes(1);
    expect(onCopyMine).toHaveBeenCalledTimes(1);
  });
});
