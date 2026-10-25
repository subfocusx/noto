import { describe, expect, it } from 'vitest';
import {
  DRAWER_EDGE_SIZE,
  SWIPE_MAX_OFF_AXIS_RATIO,
  SWIPE_MIN_DISTANCE,
  detectSwipe,
  drawerGesture,
  isEdgeStart,
  isHorizontalGesture,
  swipeVector,
} from '../core/touch/swipe';

describe('the gesture of the finger', () => {
  it('reads the movement of the finger', () => {
    expect(swipeVector({ x: 10, y: 20 }, { x: 40, y: 25 })).toEqual({ dx: 30, dy: 5 });
  });

  it('tells the direction of a swipe', () => {
    expect(detectSwipe({ x: 200, y: 100 }, { x: 120, y: 105 })).toBe('left');
    expect(detectSwipe({ x: 100, y: 100 }, { x: 180, y: 105 })).toBe('right');
    expect(detectSwipe({ x: 100, y: 200 }, { x: 105, y: 120 })).toBe('up');
    expect(detectSwipe({ x: 100, y: 100 }, { x: 105, y: 180 })).toBe('down');
  });

  it('does not take a short touch for a swipe', () => {
    expect(detectSwipe({ x: 100, y: 100 }, { x: 100 + SWIPE_MIN_DISTANCE - 1, y: 100 })).toBeNull();
  });

  it('does not take the scroll of the tree for a swipe of the drawer', () => {
    // A scroll moves the finger mostly along the vertical axis: it is a
    // vertical gesture, and the drawer never answers to it.
    expect(isHorizontalGesture({ x: 100, y: 100 }, { x: 108, y: 260 })).toBe(false);
    expect(drawerGesture({ x: 100, y: 100 }, { x: 108, y: 260 }, { open: true })).toBeNull();
    expect(drawerGesture({ x: 100, y: 100 }, { x: 108, y: 260 }, { open: false })).toBeNull();
  });

  it('accepts a swipe that is almost horizontal', () => {
    // The movement across the axis stays under the share that is allowed.
    const across = SWIPE_MAX_OFF_AXIS_RATIO * 100;
    expect(detectSwipe({ x: 100, y: 100 }, { x: 200, y: 100 + across - 1 })).toBe('right');
  });

  it('knows the edge of the screen', () => {
    expect(isEdgeStart({ x: DRAWER_EDGE_SIZE - 1, y: 200 })).toBe(true);
    expect(isEdgeStart({ x: DRAWER_EDGE_SIZE + 1, y: 200 })).toBe(false);
  });
});

describe('the gesture of the drawer', () => {
  it('opens the drawer with a swipe at the edge of the screen', () => {
    expect(drawerGesture({ x: 4, y: 300 }, { x: 90, y: 305 }, { open: false })).toBe('open');
  });

  it('does not open the drawer with a swipe in the middle of the screen', () => {
    expect(drawerGesture({ x: 300, y: 300 }, { x: 390, y: 305 }, { open: false })).toBeNull();
  });

  it('closes the drawer with a swipe to the left', () => {
    expect(drawerGesture({ x: 200, y: 300 }, { x: 110, y: 305 }, { open: true })).toBe('close');
  });

  it('does not close the drawer with a swipe to the right', () => {
    expect(drawerGesture({ x: 110, y: 300 }, { x: 200, y: 305 }, { open: true })).toBeNull();
  });

  it('does not close the drawer with the scroll of the tree', () => {
    expect(drawerGesture({ x: 200, y: 300 }, { x: 190, y: 460 }, { open: true })).toBeNull();
  });
});
