// The list of the attachments.
//
// The panel may hold hundreds of attachments: the list is therefore not drawn
// in one go. It grows by pages, and the helper that computes the visible
// rows is a pure function so that it can be tested on its own.

/** The number of the rows that are drawn at once. */
export const ATTACHMENT_PAGE_SIZE = 50;

/**
 * The rows that are visible when the panel has shown `limit` of them.
 *
 * The limit is the number of the rows the user has already asked for: the
 * helper never returns more rows than the list holds.
 */
export function visibleAttachments<T>(items: T[], limit: number): T[] {
  if (limit <= 0) return [];
  return items.slice(0, limit);
}

/** True when the list holds more rows than the panel shows. */
export function hasMoreAttachments<T>(items: T[], limit: number): boolean {
  return items.length > limit;
}
