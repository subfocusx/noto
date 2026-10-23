// The breadcrumbs of the open note.
//
// The header shows the name of the note; the breadcrumbs show the whole path
// and allow to jump into a folder of the path.
import { Icon } from '../ui/icons';

export interface NoteBreadcrumbsProps {
  /** The path of the open note; empty when no note is open. */
  path: string;
  /** Opens a folder of the path in the tree. */
  onOpenFolder(path: string): void;
}

/** One element of the path. */
interface Crumb {
  label: string;
  /** The path of the folder; empty for the note itself. */
  path: string;
  /** True for the note that is open. */
  current: boolean;
}

/** Splits a path into the elements of the breadcrumb. */
export function buildBreadcrumbs(path: string): Crumb[] {
  if (!path) return [];
  const parts = path.split('/').filter((part) => part.length > 0);
  return parts.map((label, index) => ({
    label,
    path: parts.slice(0, index + 1).join('/'),
    current: index === parts.length - 1,
  }));
}

/** The path of the note, split into the clickable elements. */
export function NoteBreadcrumbs(props: NoteBreadcrumbsProps) {
  const crumbs = buildBreadcrumbs(props.path);
  if (crumbs.length === 0) return null;

  return (
    <nav class="app-breadcrumbs" aria-label="Note path">
      <ol class="breadcrumbs">
        {crumbs.map((crumb, index) => (
          <li key={crumb.path} class="breadcrumb">
            {index > 0 ? (
              <span class="breadcrumb-separator" aria-hidden="true">
                <Icon name="chevron-right" size={12} />
              </span>
            ) : null}
            {crumb.current ? (
              <span class="breadcrumb-item current" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <button
                type="button"
                class="breadcrumb-item"
                onClick={() => props.onOpenFolder(crumb.path)}
              >
                {crumb.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
