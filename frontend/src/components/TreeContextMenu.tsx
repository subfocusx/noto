// The context menu of the tree.
//
// The menu is a small floating panel: it shows the actions of a note or of a
// folder. Every action is an icon, and its name is carried by the accessible
// label and by the native tooltip of the button. The panel names the node it
// acts on, so the user always knows which node the actions belong to. The
// menu is rendered by the sidebar when a row asks for it, and it closes as
// soon as the user leaves it.
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PluginContextMenuItem } from '../plugins/contract';
import { Icon } from '../ui/icons';
import { PluginContextMenuSlot } from './PluginSlots';

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
  /** Called when the user asks to duplicate the node (notes only). */
  onDuplicate?(): void;
  /**
   * The entries the plugins added for the node.
   *
   * The entries of a plugin belong to the menu of the node they apply to, not
   * to the footer of the column: the menu is where the user looks for the
   * actions of a note.
   */
  pluginItems?: PluginContextMenuItem[];
}

/** The distance kept between the menu and the edge of the viewport. */
const MARGIN = 8;

/**
 * The name of the node the menu acts on.
 *
 * It is the last segment of the path: the menu says which node it acts on,
 * so the user never mistakes the menu of a folder for the menu of another one.
 */
function nameOf(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] || path;
}

/** An entry of the menu: an icon, and the name of the action. */
function MenuEntry(props: {
  /** The name of the action, used as label and as tooltip. */
  label: string;
  /** True when the action is destructive. */
  danger?: boolean;
  /** Called when the action is chosen. */
  onSelect(): void;
  /** The icon of the action. */
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class={`context-menu-item${props.danger ? ' danger' : ''}`}
      role="menuitem"
      aria-label={props.label}
      title={props.label}
      onClick={props.onSelect}
    >
      {props.children}
    </button>
  );
}

export function TreeContextMenu(props: TreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closedRef = useRef(false);
  const [position, setPosition] = useState({ left: props.x, top: props.y });
  const name = nameOf(props.path);

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
      aria-label={`Actions of ${name}`}
      style={{ position: 'fixed', left: `${position.left}px`, top: `${position.top}px` }}
    >
      <div class="context-menu-title" title={name} aria-hidden="true">
        {name}
      </div>
      <MenuEntry label="Rename" onSelect={() => run(props.onRename)}>
        <Icon name="pencil" size={16} />
      </MenuEntry>
      <MenuEntry label="Move" onSelect={() => run(props.onMove)}>
        <Icon name="move" size={16} />
      </MenuEntry>
      {props.isFolder ? (
        <>
          <MenuEntry label="New note" onSelect={() => run(props.onCreateFile)}>
            <Icon name="file-plus" size={16} />
          </MenuEntry>
          <MenuEntry label="New folder" onSelect={() => run(props.onCreateFolder)}>
            <Icon name="folder-plus" size={16} />
          </MenuEntry>
        </>
      ) : null}
      {!props.isFolder && props.onDuplicate ? (
        <MenuEntry label="Duplicate" onSelect={() => run(props.onDuplicate as () => void)}>
          <Icon name="copy" size={16} />
        </MenuEntry>
      ) : null}
      {props.pluginItems && props.pluginItems.length > 0 ? (
        <PluginContextMenuSlot items={props.pluginItems} path={props.path} />
      ) : null}
      <div class="context-menu-separator" />
      <MenuEntry label="Delete" danger onSelect={() => run(props.onDelete)}>
        <Icon name="trash" size={16} />
      </MenuEntry>
    </div>
  );
}
