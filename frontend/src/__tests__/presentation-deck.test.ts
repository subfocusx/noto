// The tests of the navigation of a deck of slides.
import { describe, expect, it } from 'vitest';
import {
  createDeck,
  deckProgress,
  goToSlide,
  isFirstSlide,
  isLastSlide,
  nextSlide,
  presentationKeyAction,
  previousSlide,
} from '../core/presentations/deck';

describe('the deck of the slides', () => {
  it('starts at the first slide', () => {
    const deck = createDeck(3);

    expect(deck.index).toBe(0);
    expect(deck.total).toBe(3);
    expect(isFirstSlide(deck)).toBe(true);
    expect(isLastSlide(deck)).toBe(false);
  });

  it('moves to the next slide and stops at the last one', () => {
    const deck = createDeck(2);

    const second = nextSlide(deck);
    expect(second.index).toBe(1);
    expect(isLastSlide(second)).toBe(true);

    expect(nextSlide(second).index).toBe(1);
  });

  it('moves to the previous slide and stops at the first one', () => {
    const deck = goToSlide(createDeck(3), 2);

    expect(previousSlide(deck).index).toBe(1);
    expect(previousSlide(previousSlide(deck)).index).toBe(0);
    expect(previousSlide(createDeck(3)).index).toBe(0);
  });

  it('clamps the number of a slide to the deck', () => {
    expect(goToSlide(createDeck(3), 9).index).toBe(2);
    expect(goToSlide(createDeck(3), -4).index).toBe(0);
  });

  it('shows the progress of the sequence', () => {
    expect(deckProgress(createDeck(4))).toBe(0.25);
    expect(deckProgress(goToSlide(createDeck(4), 3))).toBe(1);
    expect(deckProgress(createDeck(0))).toBe(0);
  });
});

describe('the keyboard of the deck', () => {
  it('moves through the slides', () => {
    expect(presentationKeyAction('ArrowRight')).toBe('next');
    expect(presentationKeyAction('ArrowDown')).toBe('next');
    expect(presentationKeyAction('PageDown')).toBe('next');
    expect(presentationKeyAction(' ')).toBe('next');
    expect(presentationKeyAction('ArrowLeft')).toBe('previous');
    expect(presentationKeyAction('ArrowUp')).toBe('previous');
    expect(presentationKeyAction('PageUp')).toBe('previous');
  });

  it('closes the deck with the Escape', () => {
    expect(presentationKeyAction('Escape')).toBe('close');
  });

  it('ignores the other keys', () => {
    expect(presentationKeyAction('a')).toBe('none');
    expect(presentationKeyAction('Enter')).toBe('none');
  });
});
