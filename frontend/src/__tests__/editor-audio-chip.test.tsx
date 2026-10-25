// The tests of the chip of a sound in the editor.
//
// The reference of a recording is a Markdown link in the text of the note. In
// the editor it is shown as a chip: the icon of the microphone, the name of the
// sound, its length and the button that plays it.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import { MarkdownEditor } from '../components/Editor';

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

const REFERENCE =
  '![Recording 2026-10-25 19:56 \\(0:05\\)](/api/attachments/att-1/raw?type=audio)';

function renderEditor(value: string) {
  return render(
    <MarkdownEditor
      value={value}
      path="a.md"
      contentPath="a.md"
      onChange={() => undefined}
      onSave={() => undefined}
    />,
  );
}

describe('the chip of a sound in the editor', () => {
  it('shows the sound as a chip with its name and its length', () => {
    const { container } = renderEditor(REFERENCE);

    const chip = container.querySelector('.noto-audio-chip');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain('Audio recording');
    expect(chip?.textContent).toContain('0:05');
    expect(chip?.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('.noto-audio-chip-play')).toBeTruthy();
  });

  it('hides the Markdown of the reference', () => {
    const { container } = renderEditor(REFERENCE);

    expect(container.querySelector('.cm-content')?.textContent).not.toContain('type=audio');
  });

  it('shows nothing when the note has no sound', () => {
    const { container } = renderEditor('![photo](/api/attachments/att-2/raw)');

    expect(container.querySelector('.noto-audio-chip')).toBeNull();
  });

  it('plays the sound when the button is pressed', () => {
    const play = vi.fn(() => Promise.resolve());
    const spy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(play);

    const { container } = renderEditor(REFERENCE);
    const button = container.querySelector('.noto-audio-chip-play') as HTMLButtonElement;
    fireEvent.click(button);

    expect(play).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
