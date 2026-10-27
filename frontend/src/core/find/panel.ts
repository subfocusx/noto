// The rules of the floating window of the search and of the filters.
//
// The window is not a modal window any more: it floats over the application
// and the tree behind it stays visible and clickable.
//
// Its place is a rule of the stylesheet (`styles/find.css`) and not a
// measurement of the window itself: a window that measures itself is painted
// twice — once in the corner and once in its place — and the user sees that
// as a jump. The rules of the click that closes it live here, so they can be
// tested without a browser.

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
