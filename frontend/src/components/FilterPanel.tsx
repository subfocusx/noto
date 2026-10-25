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
import { useT } from '../i18n/useT';
import { debounce } from '../lib/debounce';
import { Icon } from '../ui/icons';

/** The delay of the query, in milliseconds. */
const QUERY_DELAY = 200;

/** The example shown when the field is empty. */
const PLACEHOLDER = 'tag == "work" && !has_task_list';

/**
 * The block of the selection.
 *
 * The query lives in the store, so the saved filters, the tags and the plugins
 * see the same one.
 */
export function FilterPanel() {
  const t = useT();
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
        <span class="q9-filter-title">{t('filter.title')}</span>
        <span class="q9-filter-hint" title={t('filter.hint')}>
          {t('filter.hint')}
        </span>
      </div>

      <div class="q9-query-field">
        <input
          type="text"
          class="q9-query-input"
          value={text}
          placeholder={PLACEHOLDER}
          aria-label={t('filter.inputLabel')}
          title={PLACEHOLDER}
          spellcheck={false}
          onInput={onInput}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            run.flush();
          }}
        />
      </div>

      {hasQuery ? (
        <div class="q9-query-status">
          {state.ui.queryError ? null : (
            <span class="q9-query-count" role="status">
              {state.ui.queryTotal === 1
                ? t('filter.oneNote')
                : t('filter.manyNotes', { count: state.ui.queryTotal })}
            </span>
          )}
          <button
            type="button"
            class="icon-button q9-query-clear"
            title={t('filter.clear')}
            aria-label={t('filter.clear')}
            onClick={clear}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ) : null}
      {state.ui.queryPartial ? (
        <p class="q9-query-warning" role="status">
          {t('filter.partial')}
        </p>
      ) : null}
      {state.ui.queryError ? (
        <p class="q9-query-error" role="alert">
          {state.ui.queryError}
        </p>
      ) : null}

      <div class="q9-filter-row">
        <span class="q9-filter-label" title={t('filter.tagsHint')}>
          {t('filter.tags')}
        </span>
        {tags.length === 0 ? (
          <span class="q9-filter-empty">{t('filter.noTags')}</span>
        ) : (
          <div class="q9-chips">
            {tags.map((tag) => (
              <button
                key={tag.tag}
                type="button"
                class="q9-chip q9-chip-tag"
                title={t('filter.tagTitle', { tag: tag.tag })}
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
        <span class="q9-filter-label" title={t('filter.savedHint')}>
          {t('filter.saved')}
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
                aria-label={t('filter.deleteFilter', { name: view.title })}
                title={t('filter.deleteFilter', { name: view.title })}
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
                placeholder={t('filter.namePlaceholder')}
                aria-label={t('filter.nameLabel')}
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
              title={t('filter.savedHint')}
              aria-label={t('filter.saveCurrent')}
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
