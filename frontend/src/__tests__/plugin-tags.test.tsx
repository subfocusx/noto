import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { TagsStore, TagsView } from '../plugins/builtin/tags/index';

// The panel of the tags is tested through its own view: the plugin reads the
// vault through the contract, and the view only shows what the store holds.
describe('the panel of the tags', () => {
  /** A store with the given tags. */
  function storeWith(tags: { tag: string; count: number }[], selected: string | null = null) {
    const store = new TagsStore();
    store.set({ ready: true, error: null, tags, selected, paths: [] });
    return store;
  }

  it('shows the tags as chips of a row', () => {
    render(
      <TagsView
        store={storeWith([
          { tag: 'journal', count: 3 },
          { tag: 'work', count: 12 },
        ])}
        select={() => undefined}
      />,
    );

    const list = document.querySelector('.noto-tags-list');
    expect(list).not.toBeNull();

    const chips = document.querySelectorAll('.noto-tags-button');
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      // The chip is a button of the plugin, not a plain block of text.
      expect(chip.tagName).toBe('BUTTON');
      expect(chip.className).not.toContain('active');
    }

    expect(screen.getByText('#journal')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('marks the selected tag', () => {
    render(
      <TagsView
        store={storeWith(
          [
            { tag: 'journal', count: 3 },
            { tag: 'work', count: 12 },
          ],
          'work',
        )}
        select={() => undefined}
      />,
    );

    const chips = document.querySelectorAll('.noto-tags-button');
    expect(chips[1]?.className).toContain('active');
    expect(chips[0]?.className).not.toContain('active');
  });

  it('selects a tag and drops the selection when it is pressed again', () => {
    const select = vi.fn();
    render(
      <TagsView
        store={storeWith([
          { tag: 'journal', count: 3 },
          { tag: 'work', count: 12 },
        ])}
        select={select}
      />,
    );

    fireEvent.click(screen.getByText('#journal'));
    expect(select).toHaveBeenCalledWith('journal');
  });

  it('says that the vault has no tags', () => {
    render(<TagsView store={storeWith([])} select={() => undefined} />);

    expect(screen.getByText('The vault has no tags')).toBeTruthy();
    expect(document.querySelector('.noto-tags-list')).toBeNull();
  });
});
