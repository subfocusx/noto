// The pencil that switches the mode of the note.
//
// One button, two modes: the note is either edited or read. The button
// stands in the far corner of the strip of the tags, not in the strip of the
// tabs: the mode belongs to the whole note, not to one tab.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import { EditorModeButton } from '../components/EditorModeButton';

describe('the pencil of the mode of the note', () => {
  it('is the pencil in both of the modes: one element, two modes', () => {
    const view = render(
      <EditorModeButton
        label="Editing mode"
        title="Switch to the reading mode"
        pressed={true}
        onClick={() => {}}
      />,
    );

    const pencil = view.getByTestId('tab-mode');
    expect(pencil.querySelector('svg')?.getAttribute('class')).toContain('lucide-pencil');
    expect(pencil.getAttribute('aria-label')).toBe('Editing mode');
    expect(pencil.getAttribute('title')).toBe('Switch to the reading mode');
    // The pencil is pressed while the note is edited.
    expect(pencil.getAttribute('aria-pressed')).toBe('true');
  });

  it('is unpressed while the note is read', () => {
    const view = render(
      <EditorModeButton
        label="Reading mode"
        title="Switch to the editing mode"
        pressed={false}
        onClick={() => {}}
      />,
    );

    const pencil = view.getByTestId('tab-mode');
    expect(pencil.getAttribute('aria-pressed')).toBe('false');
    expect(pencil.getAttribute('aria-label')).toBe('Reading mode');
  });

  it('switches the mode when the user clicks it', () => {
    const onClick = vi.fn();
    const view = render(
      <EditorModeButton
        label="Editing mode"
        title="Switch to the reading mode"
        pressed={true}
        onClick={onClick}
      />,
    );

    fireEvent.click(view.getByTestId('tab-mode'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
