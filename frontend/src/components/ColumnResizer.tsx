// The handle that resizes a column of the workspace.
//
// Both columns of the shell (the tree of the notes on the left and the outline
// on the right) are resized with the same control, so both behave the same
// way: the handle measures the width of its column when the drag starts and
// reports the new width while the pointer moves.
//
// The handle is also reachable with the keyboard: the arrow keys change the
// width of the column step by step.
export interface ColumnResizerProps {
  /** The label of the handle, read by the assistive technology. */
  label: string;
  /** The side of the column the handle belongs to. */
  side: 'left' | 'right';
  /** The smallest width of the column, in pixels. */
  min: number;
  /** The biggest width of the column, in pixels. */
  max: number;
  /** Called with the new width of the column, in pixels. */
  onResize(width: number): void;
}

/** The width of a column, measured on the element that holds it. */
function measure(element: HTMLElement | null): number {
  return element?.parentElement?.getBoundingClientRect().width ?? 0;
}

export function ColumnResizer(props: ColumnResizerProps) {
  const clamp = (value: number): number =>
    Math.min(props.max, Math.max(props.min, Math.round(value)));

  const startResize = (event: PointerEvent): void => {
    const handle = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startWidth = measure(handle);

    const move = (moveEvent: PointerEvent): void => {
      const delta = props.side === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      props.onResize(clamp(startWidth + delta));
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const handle = event.currentTarget as HTMLElement;
    const step = event.shiftKey ? 32 : 8;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      props.onResize(clamp(measure(handle) - step));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      props.onResize(clamp(measure(handle) + step));
    }
  };

  return (
    <div
      class={props.side === 'left' ? 'sidebar-resizer' : 'panel-resizer'}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      tabIndex={0}
      onPointerDown={startResize}
      onKeyDown={onKeyDown}
    />
  );
}
