import { describe, expect, it } from 'vitest';

import { buildIndex, removeIndex, searchIndex, updateIndex } from '../sealedIndex';

describe('sealed index', () => {
  it('finds a note by the tokens of its content', () => {
    const index = buildIndex([
      { path: '/a.md', name: 'a.md', content: 'a small note about rivers' },
      { path: '/b.md', name: 'b.md', content: 'a note about mountains' },
    ]);

    const hits = searchIndex(index, 'rivers');
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe('/a.md');
    expect(hits[0].kind).toBe('content');
    expect(hits[0].snippet).toContain('rivers');
  });

  it('requires every token of the query to match', () => {
    const index = buildIndex([{ path: '/a.md', name: 'a.md', content: 'rivers and mountains' }]);
    expect(searchIndex(index, 'rivers mountains')).toHaveLength(1);
    expect(searchIndex(index, 'rivers oceans')).toHaveLength(0);
    expect(searchIndex(index, '   ')).toHaveLength(0);
  });

  it('drops the stale tokens of a rewritten note', () => {
    const index = buildIndex([{ path: '/a.md', name: 'a.md', content: 'rivers' }]);
    expect(searchIndex(index, 'rivers')).toHaveLength(1);

    updateIndex(index, '/a.md', 'mountains');
    expect(searchIndex(index, 'rivers')).toHaveLength(0);
    expect(searchIndex(index, 'mountains')).toHaveLength(1);

    removeIndex(index, '/a.md');
    expect(searchIndex(index, 'mountains')).toHaveLength(0);
  });

  it('respects the limit', () => {
    const index = buildIndex([
      { path: '/a.md', name: 'a.md', content: 'rivers' },
      { path: '/b.md', name: 'b.md', content: 'rivers' },
      { path: '/c.md', name: 'c.md', content: 'rivers' },
    ]);
    expect(searchIndex(index, 'rivers', 2)).toHaveLength(2);
  });
});
