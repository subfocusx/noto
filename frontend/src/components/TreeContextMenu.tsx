// The context menu of the tree.
//
// The menu is a small floating panel: it shows the actions of a note or of a
// folder. It is rendered by the sidebar when a row asks for it, and it closes
// as soon as the user leaves it.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../ui/icons';

/** The position of the context menu, in viewport coordinates. */
export interface TreeContextMenuPayload {
  path: string;
  isFolder: boolean;
  x: number;
  y: number;
}

export interface TreeContextMenuProps {
  /** The path of the node the menu belongs to. */
  path: string;
  /** True when the node is a folder. */
  isFolder: boolean;
  /** The horizontal position of the menu, in pixels. */
  x: number;
  /** The vertical position of the menu, in pixels. */
  y: number;
  /** Called when the menu must be closed. */
  onClose(): void;
  /** Called when the user asks to rename the node. */
  onRename(): void;
  /** Called when the user asks to move the node. */
  onMove(): void;
  /** Called when the user asks to delete the node. */
  onDelete(): void;
  /** Called when the user asks to create a note (folders only). */
  onCreateFile(): void;
  /** Called when the user asks to create a folder (folders only). */
  onCreateFolder(): void;
}

/** The distance kept between the menu and the edge of the viewport. */
const MARGIN = 8;

export function TreeContextMenu(props: TreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closedRef = useRef(false);
  const [position, setPosition] = useState({ left: props.x, top: props.y });

  // The menu is measured after the first render: it is then moved back into
  // the viewport when it would overflow it.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const maxLeft = Math.max(MARGIN, window.innerWidth - rect.width - MARGIN);
    const maxTop = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
    setPosition({
      left: Math.min(Math.max(props.x, MARGIN), maxLeft),
      top: Math.min(Math.max(props.y, MARGIN), maxTop),
    });
  }, [props.x, props.y]);

  // The first item takes the focus, so the menu can be driven with the
  // keyboard right away.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>('.context-menu-item');
    first?.focus();
  }, []);

  useEffect(() => {
    const close = (): void => {
      if (closedRef.current) return;
      closedRef.current = true;
      props.onClose();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      close();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('blur', close);
    };
  }, [props.onClose]);

  const run = (action: () => void): void => {
    if (closedRef.current) return;
    closedRef.current = true;
    action();
    props.onClose();
  };

  return (
    <div
      ref={menuRef}
      class="context-menu"
      role="menu"
      aria-label={props.isFolder ? 'Folder actions' : 'Note actions'}
      style={{ position: 'fixed', left: `${position.left}px`, top: `${position.top}px` }}
    >
      <button
        type="button"
        class="context-menu-item"
        role="menuitem"
        onClick={() => run(props.onRename)}
      >
        <Icon name="pencil" size={14} />
        Rename
      </button>
      <button
        type="button"
        class="context-menu-item"
        role="menuitem"
        onClick={() => run(props.onMove)}
      >
        <Icon name="move" size={14} />
        Move
      </button>
      {props.isFolder ? (
        <>
          <button
            type="button"
            class="context-menu-item"
            role="menuitem"
            onClick={() => run(props.onCreateFile)}
          >
            <Icon name="file-plus" size={14} />
            New note
          </button>
          <button
            type="button"
            class="context-menu-item"
            role="menuitem"
            onClick={() => run(props.onCreateFolder)}
          >
            <Icon name="folder-plus" size={14} />
            New folder
          </button>
        </>
      ) : null}
      <div class="context-menu-separator" />
      <button
        type="button"
        class="context-menu-item danger"
        role="menuitem"
        onClick={() => run(props.onDelete)}
      >
        <Icon name="trash" size={14} />
        Delete
      </button>
    </div>
  );
}
