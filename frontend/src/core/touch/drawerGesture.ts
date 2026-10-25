// The gesture of the drawer.
//
// The drawer (the column of the sections under 820 px) answers to the touch:
// a swipe that starts at the edge of the screen opens it, a swipe to the left
// closes it. The gesture of the tree (a scroll) is not a swipe and never
// touches the drawer.
//
// The module is the glue between the browser and the pure detection of the
// gesture (`./swipe.ts`).
import { drawerGesture, type DrawerGesture as DrawerAction, type Point } from './swipe';

/** The width under which the column of the sections becomes a drawer. */
export const DRAWER_BREAKPOINT = 820;

/** What the gesture asks for. */
export interface DrawerGestureHandlers {
  /** The drawer is open now. */
  isOpen(): boolean;
  /** The drawer must be opened. */
  onOpen(): void;
  /** The drawer must be closed. */
  onClose(): void;
  /** The width of the edge that opens the drawer, in pixels. */
  edgeSize?: number;
}

/**
 * True when the screen is narrow enough for the drawer.
 *
 * The gesture is only listened to on a narrow screen: on a wide screen the
 * column of the sections is always there and there is nothing to open.
 */
export function isDrawerScreen(width: number = window.innerWidth): boolean {
  return width <= DRAWER_BREAKPOINT;
}

/**
 * Listens to the touch of the screen and opens or closes the drawer.
 *
 * The function returns the function that removes the listeners again.
 */
export function attachDrawerGesture(handlers: DrawerGestureHandlers): () => void {
  let start: Point | null = null;

  const onTouchStart = (event: TouchEvent): void => {
    if (event.touches.length !== 1) {
      start = null;
      return;
    }
    const touch = event.touches[0];
    if (!touch) {
      start = null;
      return;
    }
    start = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (event: TouchEvent): void => {
    const from = start;
    start = null;
    if (!from) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    if (!isDrawerScreen()) return;
    const action: DrawerAction | null = drawerGesture(from, { x: touch.clientX, y: touch.clientY }, {
      open: handlers.isOpen(),
      edgeSize: handlers.edgeSize,
    });
    if (action === 'open') handlers.onOpen();
    else if (action === 'close') handlers.onClose();
  };

  const onTouchCancel = (): void => {
    start = null;
  };

  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchCancel, { passive: true });

  return () => {
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchCancel);
  };
}
