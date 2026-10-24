// The paths of the notes of the encrypted storage.
//
// The helpers live in their own module: the service of the storage needs them,
// and the service is part of the first chunk of the application. If they were
// taken from the sealed vault, the whole crypto core would come with them.

/** The root of the vault. */
export const ROOT = '/';

/** Normalises a path: leading slash, no trailing slash, root is "/". */
export function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!trimmed || trimmed === '/') return ROOT;
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

/** Returns the parent path of a path ("/" for a top level node). */
export function parentPathOf(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === ROOT) return ROOT;
  const at = normalized.lastIndexOf('/');
  return at <= 0 ? ROOT : normalized.slice(0, at);
}

/** Returns the last segment of a path. */
export function baseNameOf(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === ROOT) return '';
  const at = normalized.lastIndexOf('/');
  return normalized.slice(at + 1);
}

/** Joins a parent path and a child name. */
export function joinPath(parentPath: string, name: string): string {
  const parent = normalizePath(parentPath);
  return parent === ROOT ? `/${name}` : `${parent}/${name}`;
}
