// Deterministic ordering helpers.

/**
 * Deterministic string comparison by code unit.
 * `localeCompare` depends on the locale of the runtime and would make the
 * order of the tree and of wiki links differ between environments.
 */
export function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
