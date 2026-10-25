// The tests of the deck of the slides in the interface.
//
// The deck is a full screen sequence of the slides: the arrows move through
// it, the Escape closes it and the progress of the sequence is shown.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/preact';
import { Preview } from '../components/Preview';
import { renderSafeMarkdown } from '../lib/markdown';

vi.mock('../lib/markdownLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/markdownLoader')>();
  return { ...actual, loadMarkdownRenderer: vi.fn(async () => renderSafeMarkdown) };
});

const NOTE = ['# The road', '', 'The first slide.', '', '---', '', '# The map', '', 'The second slide.'].join(
  '\n',
);

describe('the presentation in the preview', () => {
  it('offers the deck only for a note that declares a presentation', async () => {
    const ordinary = render(<Preview source="# A note" resolve={null} onOpenNote={() => undefined} />);
    expect(ordinary.queryByTestId('presentation-open')).toBeNull();
    ordinary.unmount();

    const view = render(<Preview source={NOTE} resolve={null} onOpenNote={() => undefined} />);
    expect(view.getByTestId('presentation-open')).toBeTruthy();
  });

  it('opens the deck of the slides and shows the progress', () => {
    const view = render(<Preview source={NOTE} resolve={null} onOpenNote={() => undefined} />);

    fireEvent.click(view.getByTestId('presentation-open'));

    expect(view.getByTestId('presentation-overlay')).toBeTruthy();
    expect(view.getByTestId('presentation-progress').textContent).toBe('1 / 2');
    expect(view.getByText('The road')).toBeTruthy();
  });

  it('moves through the slides with the arrows', () => {
    const view = render(<Preview source={NOTE} resolve={null} onOpenNote={() => undefined} />);

    fireEvent.click(view.getByTestId('presentation-open'));
    fireEvent.keyDown(document, { key: 'ArrowRight' });

    expect(view.getByTestId('presentation-progress').textContent).toBe('2 / 2');
    expect(view.getByText('The map')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'ArrowLeft' });

    expect(view.getByTestId('presentation-progress').textContent).toBe('1 / 2');
  });

  it('closes the deck with the Escape', () => {
    const view = render(<Preview source={NOTE} resolve={null} onOpenNote={() => undefined} />);

    fireEvent.click(view.getByTestId('presentation-open'));
    expect(view.queryByTestId('presentation-overlay')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(view.queryByTestId('presentation-overlay')).toBeNull();
  });
});
