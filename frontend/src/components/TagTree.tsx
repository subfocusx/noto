// The tree of the tags.
//
// The tags are counted by the storage (the backend in the open mode, the
// decrypted notes in the sealed mode). A tag is a query of the language:
// clicking it puts `tag == "<name>"` in the query bar and runs it.
import { useEffect, useMemo } from 'preact/hooks';
import { useAppActions, useAppState } from '../core/store/hooks';
import type { TagCount } from '../types';

/** A group of the tree: the tags that share a prefix. */
interface TagGroup {
  /** The name of the group; the empty string is the root. */
  name: string;
  /** The tags of the group. */
  tags: TagCount[];
}

/**
 * Groups the tags by their prefix.
 *
 * The tags of the root ("work", "urgent") are in the group of the root; the
 * tag "project/alpha" is in the group "project".
 */
function groupTags(tags: TagCount[]): TagGroup[] {
  const groups = new Map<string, TagGroup>();
  for (const tag of tags) {
    const slash = tag.tag.indexOf('/');
    const name = slash === -1 ? '' : tag.tag.slice(0, slash);
    let group = groups.get(name);
    if (!group) {
      group = { name, tags: [] };
      groups.set(name, group);
    }
    group.tags.push(tag);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The tree of the tags.
 *
 * The tags are read when the tree appears, and every time the vault changes.
 */
export function TagTree() {
  const state = useAppState();
  const actions = useAppActions();

  useEffect(() => {
    void actions.loadTags();
  }, [actions]);

  const groups = useMemo(() => groupTags(state.ui.tags), [state.ui.tags]);

  const pick = (tag: string): void => {
    const query = `tag == "${tag}"`;
    actions.setQuery(query);
    void actions.runQuery(query);
  };

  if (groups.length === 0) {
    return (
      <div class="q8-tags">
        <div class="q8-subtitle">Tags</div>
        <p class="q8-hint">No tag yet.</p>
      </div>
    );
  }

  return (
    <div class="q8-tags">
      <div class="q8-subtitle">Tags</div>
      {groups.map((group) => (
        <div key={group.name || 'root'} class="q8-tag-group">
          {group.name ? <div class="q8-tag-group-name">{group.name}</div> : null}
          <ul class="q8-tag-list">
            {group.tags.map((tag) => (
              <li key={tag.tag}>
                <button
                  type="button"
                  class="q8-tag"
                  title={`Show the notes tagged ${tag.tag}`}
                  onClick={() => pick(tag.tag)}
                >
                  <span class="q8-tag-name">#{tag.tag}</span>
                  <span class="q8-tag-count">{tag.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
