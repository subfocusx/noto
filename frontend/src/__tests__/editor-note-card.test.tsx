import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { NoteCard } from '../components/NoteCard';

describe('the card of a note', () => {
  it('shows the title of the note', () => {
    const view = render(<NoteCard title="A note" />);
    expect(view.getByText('A note')).toBeTruthy();
    expect(view.getByTestId('note-card')).toBeTruthy();
  });

  it('shows the tags of the note', () => {
    const view = render(<NoteCard title="A note" tags={['work', 'home']} />);
    expect(view.getByText('#work')).toBeTruthy();
    expect(view.getByText('#home')).toBeTruthy();
  });

  it('shows the way into the vault', () => {
    const view = render(<NoteCard title="A note" path="journal/2026/plan.md" />);
    expect(view.getByText('journal')).toBeTruthy();
    expect(view.getByText('2026')).toBeTruthy();
  });

  it('shows the dates of the note', () => {
    const view = render(
      <NoteCard
        title="A note"
        createdAt="2026-01-02T10:00:00Z"
        updatedAt="2026-03-04T10:00:00Z"
      />,
    );
    expect(view.getByText(/Created 2026-01-02/)).toBeTruthy();
    expect(view.getByText(/Changed 2026-03-04/)).toBeTruthy();
  });

  it('shows the number of the words', () => {
    const view = render(<NoteCard title="A note" wordCount={12} />);
    expect(view.getByText('12 words')).toBeTruthy();
  });

  it('shows a single word in the singular', () => {
    const view = render(<NoteCard title="A note" wordCount={1} />);
    expect(view.getByText('1 word')).toBeTruthy();
  });

  it('shows nothing that the note does not carry', () => {
    const view = render(<NoteCard title="A note" />);
    expect(view.container.querySelector('.note-card-tags')).toBeNull();
    expect(view.container.querySelector('.note-card-path')).toBeNull();
    expect(view.container.querySelector('.note-card-words')).toBeNull();
  });
});
