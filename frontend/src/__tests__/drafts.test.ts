import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { deleteDraft, getDraft, isDraftNewer, listDrafts, putDraft } from '../lib/drafts';

beforeEach(async () => {
  for (const draft of await listDrafts()) {
    await deleteDraft(draft.path);
  }
});

describe('local drafts', () => {
  it('stores, reads and removes a draft', async () => {
    await putDraft({ path: 'a.md', content: 'local text', revision: 2, updatedAt: 1000 });
    const draft = await getDraft('a.md');
    expect(draft?.content).toBe('local text');
    expect(draft?.revision).toBe(2);

    await deleteDraft('a.md');
    expect(await getDraft('a.md')).toBeUndefined();
  });

  it('detects a draft newer than the server copy', () => {
    const serverUpdatedAt = new Date(1000).toISOString();
    expect(
      isDraftNewer(
        { path: 'a.md', content: 'new', revision: 1, updatedAt: 2000 },
        serverUpdatedAt,
        'old',
      ),
    ).toBe(true);
    expect(
      isDraftNewer(
        { path: 'a.md', content: 'old', revision: 1, updatedAt: 500 },
        serverUpdatedAt,
        'old',
      ),
    ).toBe(false);
    expect(
      isDraftNewer(
        { path: 'a.md', content: 'same', revision: 1, updatedAt: 5000 },
        serverUpdatedAt,
        'same',
      ),
    ).toBe(false);
  });
});
