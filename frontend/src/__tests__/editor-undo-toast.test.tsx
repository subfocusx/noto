import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import { UndoDeleteToast } from '../components/NoteDialogs';

describe('the toast of the undo of a deletion', () => {
  it('shows nothing when there is no deletion to undo', () => {
    const view = render(<UndoDeleteToast offer={null} onUndo={() => undefined} onDismiss={() => undefined} />);
    expect(view.container.querySelector('[data-testid="undo-delete-toast"]')).toBeNull();
  });

  it('names the note that was deleted', () => {
    const view = render(
      <UndoDeleteToast
        offer={{ path: 'a.md', name: 'a.md' }}
        onUndo={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(view.getByText('a.md')).toBeTruthy();
    expect(view.getByText('Undo')).toBeTruthy();
  });

  it('calls the undo when the user presses the button', () => {
    const onUndo = vi.fn();
    const view = render(
      <UndoDeleteToast offer={{ path: 'a.md', name: 'a.md' }} onUndo={onUndo} onDismiss={() => undefined} />,
    );
    fireEvent.click(view.getByText('Undo'));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
