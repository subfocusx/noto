import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface DialogProps {
  title: string;
  open: boolean;
  onClose(): void;
  children?: ComponentChildren;
  footer?: ComponentChildren;
}

/** Accessible modal dialog: focus moves inside on open and returns on close. */
export function Dialog(props: DialogProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    previous.current = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = node?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        props.onClose();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous.current?.focus?.();
    };
  }, [props.open]);

  if (!props.open) return null;

  return (
    <div class="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        ref={ref}
      >
        <header class="dialog-header">
          <h2>{props.title}</h2>
          <button type="button" class="icon-button" aria-label="Close dialog" onClick={props.onClose}>
            ×
          </button>
        </header>
        <div class="dialog-body">{props.children}</div>
        {props.footer ? <footer class="dialog-footer">{props.footer}</footer> : null}
      </div>
    </div>
  );
}
