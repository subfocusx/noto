// The icon system of Noto.
//
// Every icon of the interface comes from this module, so the whole application
// shares one visual language: the same stroke width, the same size and the
// same colour rules.
//
// The icons are Lucide icons (the `lucide-preact` package). They are imported
// one by one, so the bundler only ships the icons that are really used.
//
// The registry grows with the interface: a name is never removed, because a
// plugin may refer to an icon by its name.
import {
  Archive,
  Bell,
  Bookmark,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  Clock,
  Command,
  Copy,
  Eye,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Funnel,
  Hash,
  Image,
  Link,
  Lock,
  LockOpen,
  Menu,
  Moon,
  MoreHorizontal,
  MoreVertical,
  Move,
  Network,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Star,
  Sun,
  Tags,
  Trash2,
  Upload,
  X,
  type LucideProps,
} from 'lucide-preact';
import type { ComponentType } from 'preact';

/**
 * The icons the application knows.
 *
 * The list is deliberately short: every icon of the registry is part of the
 * bundle, so an icon that nothing uses is a waste of bytes. An unknown name is
 * not an error — the icon falls back to a neutral dot.
 */
export const ICONS = {
  archive: Archive,
  bell: Bell,
  bookmark: Bookmark,
  calendar: Calendar,
  circle: Circle,
  clock: Clock,
  command: Command,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'chevrons-down-up': ChevronsDownUp,
  'chevrons-up-down': ChevronsUpDown,
  copy: Copy,
  'dots-vertical': MoreVertical,
  'file-plus': FilePlus,
  'file-text': FileText,
  filter: Funnel,
  eye: Eye,
  folder: Folder,
  'folder-open': FolderOpen,
  'folder-plus': FolderPlus,
  hash: Hash,
  image: Image,
  link: Link,
  lock: Lock,
  'lock-open': LockOpen,
  menu: Menu,
  moon: Moon,
  'more-horizontal': MoreHorizontal,
  move: Move,
  network: Network,
  'panel-left': PanelLeft,
  'panel-right': PanelRight,
  pencil: Pencil,
  plus: Plus,
  puzzle: Puzzle,
  'refresh-cw': RefreshCw,
  'rotate-ccw': RotateCcw,
  search: Search,
  settings: Settings,
  star: Star,
  sun: Sun,
  tags: Tags,
  trash: Trash2,
  upload: Upload,
  x: X,
} as const satisfies Record<string, ComponentType<LucideProps>>;

/** The name of an icon of the registry. */
export type IconName = keyof typeof ICONS;

/** Every known icon name, sorted — used by the documentation and the tests. */
export const ICON_NAMES = Object.keys(ICONS).sort() as IconName[];

/** True when the name belongs to the registry. */
export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

export interface IconProps {
  /** The name of the icon; an unknown name falls back to a neutral dot. */
  name: string;
  /** The size of the icon in pixels. */
  size?: number;
  /** The stroke width; every icon uses the same one. */
  strokeWidth?: number;
  /** Accessible label; without it the icon is decorative. */
  label?: string;
  class?: string;
}

/** The stroke width of every icon of the application. */
export const ICON_STROKE_WIDTH = 1.75;

/**
 * Renders an icon of the registry.
 *
 * Without a `label` the icon is decorative: it is hidden from the assistive
 * technology and the surrounding button keeps its own accessible name.
 */
export function Icon(props: IconProps) {
  const Component = (isIconName(props.name) ? ICONS[props.name] : ICONS.circle) as ComponentType<
    LucideProps
  >;
  const size = props.size ?? 16;
  const decorative = props.label === undefined;
  return (
    <Component
      width={size}
      height={size}
      strokeWidth={props.strokeWidth ?? ICON_STROKE_WIDTH}
      class={props.class}
      aria-hidden={decorative ? 'true' : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={props.label}
    />
  );
}
