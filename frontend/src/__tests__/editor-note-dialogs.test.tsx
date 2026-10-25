import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import { NoteDialogs } from '../components/NoteDialogs';

function renderDialogs(overrides: Partial<Parameters<typeof NoteDialogs>[0]> = {}) {
  const props = {
    dialog: { kind: null } as Parameters<typeof NoteDialogs>[0]['dialog'],
    folderPaths: [] as string[],
    draftOffer: null as Parameters<typeof NoteDialogs>[0]['draftOffer'],
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    onChangeValue: vi.fn(),
    onRestoreDraft: vi.fn(),
    onDiscardDraft: vi.fn(),
    ...overrides,
  };
  const view = render(<NoteDialogs {...props} />);
  return { view, props };
}

describe('the dialogs of the notes', () => {
  it('offers the recovery of the draft when there is one', () => {
    const { view } = renderDialogs({
      draftOffer: { path: 'a.md', content: 'local', revision: 1, updatedAt: 0 },
    });
    expect(view.getByText('Recover local draft?')).toBeTruthy();
  });

  it('resets the draft on the request of the user', () => {
    const onResetDraft = vi.fn();
    const { view } = renderDialogs({
      draftOffer: { path: 'a.md', content: 'local', revision: 1, updatedAt: 0 },
      onResetDraft,
    });
    fireEvent.click(view.getByText('Reset the draft'));
    expect(onResetDraft).toHaveBeenCalledTimes(1);
  });

  it('keeps the discard and the restore of the draft', () => {
    const onDiscardDraft = vi.fn();
    const onRestoreDraft = vi.fn();
    const { view } = renderDialogs({
      draftOffer: { path: 'a.md', content: 'local', revision: 1, updatedAt: 0 },
      onDiscardDraft,
      onRestoreDraft,
    });
    fireEvent.click(view.getByText('Discard'));
    fireEvent.click(view.getByText('Restore'));
    expect(onDiscardDraft).toHaveBeenCalledTimes(1);
    expect(onRestoreDraft).toHaveBeenCalledTimes(1);
  });
});
