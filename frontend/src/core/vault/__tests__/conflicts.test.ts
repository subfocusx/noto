import { describe, expect, it } from 'vitest';

import { detectConflicts, mergeManifests, resolveManifestBranches } from '../conflicts';
import type { ManifestEntry, SealedManifest } from '../types';
import { FakeBackend, fakeClient } from './fakeBackend';

/** Builds a manifest entry for the tests. */
function entry(path: string, overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    id: 'a'.repeat(32),
    type: 'file',
    name: path.split('/').pop() ?? path,
    path,
    parentPath: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/',
    size: 10,
    modTime: '2024-01-01T00:00:00.000Z',
    revision: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Builds a manifest for the tests. */
function manifest(generation: number, entries: ManifestEntry[]): SealedManifest {
  return {
    format: 1,
    generation,
    createdAt: `2024-01-0${generation}T00:00:00.000Z`,
    epoch: 1,
    entries,
    trash: [],
  };
}

describe('manifest branches', () => {
  it('lets the newest branch win and reports the other one', () => {
    const older = manifest(3, [entry('/a.md')]);
    const newer = manifest(7, [entry('/a.md'), entry('/b.md')]);

    const resolved = resolveManifestBranches([older, newer]);
    expect(resolved.manifest).toBe(newer);
    expect(resolved.conflicts).toEqual([older]);
  });

  it('merges by path and lists the diverging content ids', () => {
    const base = manifest(2, [
      entry('/a.md', { contentId: '1'.repeat(32), updatedAt: '2024-01-01T00:00:00.000Z' }),
    ]);
    const other = manifest(3, [
      entry('/a.md', { contentId: '2'.repeat(32), updatedAt: '2024-02-01T00:00:00.000Z' }),
      entry('/b.md', { contentId: '3'.repeat(32) }),
    ]);

    const merged = mergeManifests(base, other);
    expect(merged.entries.map((item) => item.path).sort()).toEqual(['/a.md', '/b.md']);
    const kept = merged.entries.find((item) => item.path === '/a.md');
    expect(kept?.contentId).toBe('2'.repeat(32));
    expect(merged.conflicts).toContain('1'.repeat(32));
    expect(merged.conflicts).toContain('2'.repeat(32));
  });

  it('detects the generations that the backend knows and the client does not', async () => {
    const backend = new FakeBackend();
    backend.manifests.set(1, new Uint8Array([1]));
    backend.manifests.set(2, new Uint8Array([2]));
    backend.manifests.set(3, new Uint8Array([3]));

    const unknown = await detectConflicts(fakeClient(backend), [3]);
    expect(unknown).toEqual([1, 2]);
  });
});
