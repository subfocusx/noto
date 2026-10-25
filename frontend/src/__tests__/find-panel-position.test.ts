// The tests of the place of the floating window of the search and of the
// filters.
//
// The window is not a modal window: it floats over the application and the
// tree behind it stays clickable.
import { describe, expect, it } from 'vitest';
import {
  PANEL_MARGIN,
  PANEL_WIDTH,
  closesOnClickOutside,
  containsPoint,
  findPanelRect,
} from '../core/find/panel';

const VIEWPORT = { width: 1280, height: 800 };
const SIZE = { x: 0, y: 0, width: PANEL_WIDTH, height: 400 };

describe('the place of the floating window', () => {
  it('sits right of the column of the tree', () => {
    const anchor = { x: 0, y: 0, width: 300, height: 800 };
    const rect = findPanelRect(VIEWPORT, SIZE, anchor);

    expect(rect.x).toBe(300 + PANEL_MARGIN);
    expect(rect.y).toBe(PANEL_MARGIN);
    expect(rect.width).toBe(PANEL_WIDTH);
  });

  it('never leaves the screen', () => {
    const anchor = { x: 0, y: 0, width: 1200, height: 800 };
    const rect = findPanelRect(VIEWPORT, SIZE, anchor);

    expect(rect.x).toBeLessThanOrEqual(VIEWPORT.width - rect.width);
    expect(rect.x).toBeGreaterThanOrEqual(PANEL_MARGIN);
    expect(rect.y).toBeGreaterThanOrEqual(PANEL_MARGIN);
  });

  it('sits in the corner of the screen without an anchor', () => {
    const rect = findPanelRect(VIEWPORT, SIZE);

    expect(rect.x + rect.width).toBe(VIEWPORT.width - PANEL_MARGIN);
    expect(rect.y).toBe(PANEL_MARGIN);
  });

  it('shrinks a window that does not fit', () => {
    const rect = findPanelRect({ width: 400, height: 300 }, { x: 0, y: 0, width: 900, height: 800 });

    expect(rect.width).toBe(400 - PANEL_MARGIN * 2);
    expect(rect.height).toBe(300 - PANEL_MARGIN * 2);
  });
});

describe('the click outside of the window', () => {
  const rect = { x: 100, y: 100, width: 400, height: 300 };

  it('does not close the window for a click inside it', () => {
    expect(containsPoint(rect, { x: 200, y: 200 })).toBe(true);
    expect(closesOnClickOutside(rect, { x: 200, y: 200 })).toBe(false);
  });

  it('closes the window for a click on the tree behind it', () => {
    expect(closesOnClickOutside(rect, { x: 20, y: 400 })).toBe(true);
  });
});
