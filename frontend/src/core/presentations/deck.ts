// The state of a presentation and its navigation.
//
// The state is plain data: the component of the deck holds it, the keyboard
// only says what the user wants ("the next slide", "the previous one", "close
// the deck"). The rules of the navigation live here, so they can be tested
// without a browser.

/** The state of a deck of slides. */
export interface DeckState {
  /** The number of the slide that is shown, counted from zero. */
  index: number;
  /** The number of the slides of the deck. */
  total: number;
}

/** What the keyboard asks the deck to do. */
export type DeckAction = 'next' | 'previous' | 'close' | 'none';

/** The state of a deck that shows the given number of slides. */
export function createDeck(total: number): DeckState {
  return { index: 0, total: Math.max(0, total) };
}

/** The next slide; the last slide stays the last one. */
export function nextSlide(state: DeckState): DeckState {
  if (state.total === 0) return state;
  return { ...state, index: Math.min(state.index + 1, state.total - 1) };
}

/** The previous slide; the first slide stays the first one. */
export function previousSlide(state: DeckState): DeckState {
  if (state.total === 0) return state;
  return { ...state, index: Math.max(state.index - 1, 0) };
}

/** The slide of the given number; the number is clamped to the deck. */
export function goToSlide(state: DeckState, index: number): DeckState {
  if (state.total === 0) return state;
  return { ...state, index: Math.min(Math.max(index, 0), state.total - 1) };
}

/** True when the deck shows its first slide. */
export function isFirstSlide(state: DeckState): boolean {
  return state.index <= 0;
}

/** True when the deck shows its last slide. */
export function isLastSlide(state: DeckState): boolean {
  return state.total > 0 && state.index >= state.total - 1;
}

/** How much of the deck is shown, from 0 to 1. */
export function deckProgress(state: DeckState): number {
  if (state.total === 0) return 0;
  return (state.index + 1) / state.total;
}

/**
 * What a key of the keyboard asks the deck to do.
 *
 * The arrows and the page keys move through the slides, the space moves to the
 * next slide, the Escape closes the deck.
 */
export function presentationKeyAction(key: string): DeckAction {
  if (key === 'Escape') return 'close';
  if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ') return 'next';
  if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') return 'previous';
  if (key === 'Home') return 'previous';
  if (key === 'End') return 'next';
  return 'none';
}
