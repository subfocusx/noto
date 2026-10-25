// The place of the floating window of the search and of the filters.
//
// The window is not a modal window any more: it floats over the application
// and the tree behind it stays visible and clickable. The rules of its place
// and of the click that closes it live here, so they can be tested without a
// browser.

/** A point of the screen. */
export interface Point {
  x: number;
  y: number;
}

/** A rectangle of the screen. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The size of the screen. */
export interface Viewport {
  width: number;
  height: number;
}

/** The margin between the window and the border of the screen. */
export const PANEL_MARGIN = 16;

/** The width of the window. */
export const PANEL_WIDTH = 620;

/** The maximal height of the window. */
export const PANEL_MAX_HEIGHT = 480;

/**
 * The place of the floating window.
 *
 * The window floats over the application, never over the tree: without an
 * anchor it sits in the upper right corner (over the editor), with an anchor
 * (the column of the tree) it sits right of that column. The window never
 * leaves the screen: a window that does not fit is pinned to the margin.
 */
export function findPanelRect(viewport: Viewport, size: Rect, anchor?: Rect): Rect {
  const width = Math.min(size.width, Math.max(0, viewport.width - PANEL_MARGIN * 2));
  const height = Math.min(size.height, Math.max(0, viewport.height - PANEL_MARGIN * 2));
  const maxX = Math.max(PANEL_MARGIN, viewport.width - width - PANEL_MARGIN);
  const maxY = Math.max(PANEL_MARGIN, viewport.height - height - PANEL_MARGIN);

  let x: number;
  if (anchor) {
    // The window goes right of the column of the tree; when there is no room
    // it goes over the workspace, but never over the tree itself.
    const right = anchor.x + anchor.width + PANEL_MARGIN;
    x = right + width <= viewport.width - PANEL_MARGIN ? right : Math.max(PANEL_MARGIN, anchor.x);
  } else {
    x = viewport.width - width - PANEL_MARGIN;
  }
  const y = anchor ? anchor.y : PANEL_MARGIN;

  return {
    x: Math.min(Math.max(PANEL_MARGIN, x), maxX),
    y: Math.min(Math.max(PANEL_MARGIN, y), maxY),
    width,
    height,
  };
}

/** True when the point is inside the rectangle. */
export function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * True when the click closes the window.
 *
 * A click inside the window belongs to the window; a click outside of it
 * closes it. The click on the tree is a click outside: the window closes and
 * the tree gets the click.
 */
export function closesOnClickOutside(rect: Rect, point: Point): boolean {
  return !containsPoint(rect, point);
}
