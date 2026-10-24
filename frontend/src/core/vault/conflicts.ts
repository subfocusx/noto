// Resolution of the manifest branches.
//
// The sealed vault keeps the last generations of the encrypted manifest.
// A file sync service (OneDrive, Google Drive) may however put several
// branches of that history next to each other. The client must never
// silently drop the newer branch: the losers are reported as conflicts so
// that the user can decide what to do with them.

import type { SealedClient } from './sealedClient';
import type { ManifestEntry, ManifestTrashEntry, SealedManifest } from './types';

/**
 * Returns the generations that exist on the backend but are unknown locally.
 *
 * They are the branches that appeared through a sync service. The list is
 * sorted and contains no duplicates.
 */
export async function detectConflicts(
  client: SealedClient,
  generations: number[],
): Promise<number[]> {
  const remote = await client.listGenerations();
  const known = new Set(generations);
  const unknown = remote.filter((generation) => !known.has(generation));
  return Array.from(new Set(unknown)).sort((a, b) => a - b);
}

/**
 * Chooses the winning branch of several manifests.
 *
 * The branch with the highest generation wins; every other branch is
 * returned as a conflict so that no work is lost silently.
 */
export function resolveManifestBranches(manifests: SealedManifest[]): {
  manifest: SealedManifest;
  conflicts: SealedManifest[];
} {
  if (manifests.length === 0) {
    throw new Error('cannot resolve an empty set of manifest branches');
  }
  let winner = manifests[0];
  for (const candidate of manifests.slice(1)) {
    if (candidate.generation > winner.generation) winner = candidate;
  }
  const conflicts = manifests.filter((manifest) => manifest !== winner);
  return { manifest: winner, conflicts };
}

/**
 * Merges two manifests conservatively, by path.
 *
 * A path that exists on only one side is kept as it is. A path that exists on
 * both sides keeps the newer `updatedAt`. When the two sides point at
 * different content objects, the ids of both objects are listed in
 * `conflicts` instead of being merged silently.
 */
export function mergeManifests(base: SealedManifest, other: SealedManifest): SealedManifest {
  const conflicts: string[] = [];
  const entries = new Map<string, ManifestEntry>();
  for (const entry of base.entries) entries.set(entry.path, entry);

  for (const entry of other.entries) {
    const existing = entries.get(entry.path);
    if (!existing) {
      entries.set(entry.path, entry);
      continue;
    }
    const newer = other.createdAt > existing.createdAt ? entry : existing;
    const older = newer === existing ? entry : existing;
    if (newer.contentId && older.contentId && newer.contentId !== older.contentId) {
      conflicts.push(newer.contentId, older.contentId);
    }
    entries.set(entry.path, newer);
  }

  const trash = new Map<string, ManifestTrashEntry>();
  for (const entry of base.trash) trash.set(entry.originalPath, entry);
  for (const entry of other.trash) {
    const existing = trash.get(entry.originalPath);
    if (!existing || entry.deletedAt > existing.deletedAt) trash.set(entry.originalPath, entry);
  }

  const merged: SealedManifest = {
    format: base.format,
    generation: Math.max(base.generation, other.generation),
    createdAt: other.createdAt > base.createdAt ? other.createdAt : base.createdAt,
    epoch: base.epoch,
    entries: Array.from(entries.values()),
    trash: Array.from(trash.values()),
  };
  if (conflicts.length > 0) merged.conflicts = Array.from(new Set(conflicts));
  return merged;
}
