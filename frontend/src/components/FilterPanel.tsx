// The block of the selection.
//
// The block answers one question: "which notes do I want to see right now?".
// It holds three things:
//
//   * the query of the query language (the field) with the number of the
//     matching notes;
//   * the tags of the vault as chips — a click puts `tag == "name"` into the
//     field and runs it;
//   * the saved filters — a filter under a name, applied with one click.
//
// The block never hides anything silently: the query filters the tree of the
// notes (see `Sidebar`), and the counter always shows how many notes matched.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useAppActions, useAppState } from '../core/store/hooks';
import { createView, loadViews, saveViews, type SavedView } from '../core/views/types';
import { debounce } from '../lib/debounce';
import { Icon } from '../ui/icons';

/** The delay of the query, in milliseconds. */
const QUERY_DELAY = 200;

/** The example shown when the field is empty. */
const PLACEHOLDER = 'tag == "work" && !has_task_list';

/** The explanation of the block; it is visible, not only a tooltip. */
const HINT = 'Shows only the notes that match the condition.';

/** The explanation of the tags; it is the tooltip of the label. */
const TAGS_HINT = 'A tag is written in the text of a note as #word. Click a tag to filter by it.';

/** The explanation of the saved filters; it is the tooltip of the label. */
const SAVED_HINT = 'Save the current filter under a name to come back to it later.';

/**
 * The block of the selection.
 *
 * The query lives in the store, so the saved filters, the tags and the plugins
 * see the same one.
 */
export function FilterPanel() {
  const state = useAppState();
  const actions = useAppActions();
  const [text, setText] = useState(state.ui.query);
  const [views, setViews] = useState<SavedView[]>(() => loadViews());
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const nameRef = useRef<HTMLInputElement | null>(null);

  // The query of the store is the reference: it can change outside of the
  // field (a saved filter, a tag of the list).
  useEffect(() => {
    setText(state.ui.query);
  }, [state.ui.query]);

  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  // The tags of the vault are needed for the chips of the tags.
  useEffect(() => {
    void actions.loadTags();
  }, [actions]);

  const run = useRef(
    debounce((value: string) => {
      void actions.runQuery(value);
    }, QUERY_DELAY),
  ).current;

  useEffect(() => () => run.cancel(), [run]);

  const onInput = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value;
    setText(value);
    actions.setQuery(value);
    run(value);
  };

  const clear = (): void => {
    run.cancel();
    setText('');
    actions.clearQuery();
  };

  /** Puts a query into the field and runs it at once. */
  const applyQuery = (query: string): void => {
    run.cancel();
    setText(query);
    actions.setQuery(query);
    void actions.runQuery(query);
  };

  const applyView = (view: SavedView): void => {
    applyQuery(view.query);
  };

  const saveView = (): void => {
    const title = name.trim();
    const query = state.ui.query.trim();
    if (!title || !query) return;
    const next = [...views, createView(title, query)];
    setViews(next);
    saveViews(next);
    setName('');
    setAdding(false);
  };

  const removeView = (id: string): void => {
    const next = views.filter((view) => view.id !== id);
    setViews(next);
    saveViews(next);
  };

  const tags = useMemo(
    () => [...state.ui.tags].sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag)),
    [state.ui.tags],
  );

  const hasQuery = state.ui.query.trim().length > 0;

  return (
    <div class="q9-filter">
      <div class="q9-filter-header">
        <span class="q9-filter-title">Filter</span>
        <span class="q9-filter-hint" title={HINT}>
          {HINT}
        </span>
      </div>

      <div class="q9-query-field">
        <input
          type="text"
          class="q9-query-input"
          value={text}
          placeholder={PLACEHOLDER}
          aria-label="Filter of the notes"
          title={PLACEHOLDER}
          spellcheck={false}
          onInput={onInput}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            run.flush();
          }}
        />
        {hasQuery ? (
          <button
            type="button"
            class="icon-button q9-query-clear"
            title="Clear the filter"
            aria-label="Clear the filter"
            onClick={clear}
          >
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>

      {hasQuery && !state.ui.queryError ? (
        <span class="q9-query-count" role="status">
          {state.ui.queryTotal} {state.ui.queryTotal === 1 ? 'note' : 'notes'} match
          {state.ui.queryTotal === 1 ? 'es' : ''}
        </span>
      ) : null}
      {state.ui.queryPartial ? (
        <p class="q9-query-warning" role="status">
          Some notes could not be checked: the answer may be incomplete.
        </p>
      ) : null}
      {state.ui.queryError ? (
        <p class="q9-query-error" role="alert">
          {state.ui.queryError}
        </p>
      ) : null}

      <div class="q9-filter-row">
        <span class="q9-filter-label" title={TAGS_HINT}>
          Tags
        </span>
        {tags.length === 0 ? (
          <span class="q9-filter-empty">No tag yet.</span>
        ) : (
          <div class="q9-chips">
            {tags.map((tag) => (
              <button
                key={tag.tag}
                type="button"
                class="q9-chip q9-chip-tag"
                title={`Show the notes tagged ${tag.tag}`}
                onClick={() => applyQuery(`tag == "${tag.tag}"`)}
              >
                <span class="q9-chip-name">#{tag.tag}</span>
                <span class="q9-chip-count">{tag.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div class="q9-filter-row">
        <span class="q9-filter-label" title={SAVED_HINT}>
          Saved
        </span>
        <div class="q9-chips">
          {views.map((view) => (
            <span key={view.id} class="q9-chip q9-chip-saved">
              <button
                type="button"
                class="q9-chip-main"
                title={view.query}
                onClick={() => applyView(view)}
              >
                {view.title}
              </button>
              <button
                type="button"
                class="q9-chip-x"
                aria-label={`Delete the filter ${view.title}`}
                title={`Delete the filter ${view.title}`}
                onClick={() => removeView(view.id)}
              >
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
          {adding ? (
            <span class="q9-chip q9-chip-saved">
              <input
                ref={nameRef}
                type="text"
                class="q9-chip-input"
                value={name}
                placeholder="Name"
                aria-label="Name of the filter"
                onInput={(event) => setName((event.target as HTMLInputElement).value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    saveView();
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setAdding(false);
                    setName('');
                  }
                }}
              />
            </span>
          ) : (
            <button
              type="button"
              class="q9-chip q9-chip-add"
              title={SAVED_HINT}
              aria-label="Save the current filter"
              disabled={!hasQuery}
              onClick={() => setAdding(true)}
            >
              <Icon name="plus" size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
