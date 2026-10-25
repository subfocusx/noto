// The gesture of the finger.
//
// The drawer of the application (the column of the sections under 820 px) must
// answer to the touch: a swipe opens it, a swipe closes it, and a scroll of the
// tree must not be taken for a swipe.
//
// The module is pure: it takes the points of the gesture and gives the answer.
// The glue that listens to the events of the browser lives in
// `./drawerGesture.ts`.
import type { RefObject } from 'preact';

/** A point of the screen. */
export interface Point {
  x: number;
  y: number;
}

/** The direction of a swipe. */
export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

/** What the gesture of the finger asks for. */
export type DrawerGesture = 'open' | 'close';

/**
 * The smallest distance of a swipe, in pixels.
 *
 * The distance is a compromise: a shorter one catches the accidental touches,
 * a longer one misses the quick gesture of the thumb.
 */
export const SWIPE_MIN_DISTANCE = 48;

/**
 * The biggest share of the movement that may lie across the axis of the swipe.
 *
 * A scroll of the tree moves the finger mostly along the vertical axis: such a
 * movement is not a swipe and must not close the drawer.
 */
export const SWIPE_MAX_OFF_AXIS_RATIO = 0.6;

/** The width of the edge that opens the drawer, in pixels. */
export const DRAWER_EDGE_SIZE = 32;

/** The thresholds of a gesture. */
export interface SwipeOptions {
  /** The smallest distance of the swipe, in pixels. */
  minDistance?: number;
  /** The biggest share of the movement across the axis. */
  maxOffAxisRatio?: number;
}

/** The movement of the finger between two points. */
export interface SwipeVector {
  dx: number;
  dy: number;
}

/** The movement of the finger between the two points. */
export function swipeVector(start: Point, end: Point): SwipeVector {
  return { dx: end.x - start.x, dy: end.y - start.y };
}

/**
 * The direction of the swipe between two points.
 *
 * The answer is `null` when the movement is too short or when it lies too much
 * across the axis: a scroll of the tree is not a swipe.
 */
export function detectSwipe(start: Point, end: Point, options: SwipeOptions = {}): SwipeDirection | null {
  const minDistance = options.minDistance ?? SWIPE_MIN_DISTANCE;
  const maxOffAxisRatio = options.maxOffAxisRatio ?? SWIPE_MAX_OFF_AXIS_RATIO;
  const { dx, dy } = swipeVector(start, end);
  const distance = Math.hypot(dx, dy);
  if (distance < minDistance) return null;

  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const along = horizontal ? Math.abs(dx) : Math.abs(dy);
  const across = horizontal ? Math.abs(dy) : Math.abs(dx);
  if (across > along * maxOffAxisRatio) return null;

  if (horizontal) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/**
 * True when the gesture moves mostly along the horizontal axis.
 *
 * The drawer is opened and closed sideways: a vertical movement is a scroll.
 */
export function isHorizontalGesture(start: Point, end: Point): boolean {
  const { dx, dy } = swipeVector(start, end);
  return Math.abs(dx) > Math.abs(dy);
}

/**
 * True when the finger started at the edge of the screen.
 *
 * Only a swipe that starts at the edge opens the drawer: a swipe in the
 * middle of the screen belongs to the content.
 */
export function isEdgeStart(start: Point, edgeSize: number = DRAWER_EDGE_SIZE): boolean {
  return start.x <= edgeSize;
}

/**
 * What the gesture of the finger asks for.
 *
 * The drawer is on the left of the screen: a swipe to the right opens it and a
 * swipe to the left closes it. A closed drawer only answers to a swipe that
 * started at the edge of the screen.
 */
export function drawerGesture(
  start: Point,
  end: Point,
  options: { open: boolean; edgeSize?: number; minDistance?: number } = { open: false },
): DrawerGesture | null {
  const direction = detectSwipe(start, end, { minDistance: options.minDistance });
  if (direction !== 'left' && direction !== 'right') return null;
  if (options.open) return direction === 'left' ? 'close' : null;
  if (!isEdgeStart(start, options.edgeSize)) return null;
  return direction === 'right' ? 'open' : null;
}

/**
 * The element that the gesture of the drawer listens on.
 *
 * The type is the one of the hooks of Preact: the core does not import the
 * interface, it only names the shape of the reference.
 */
export type GestureTarget = RefObject<HTMLElement | null>;
