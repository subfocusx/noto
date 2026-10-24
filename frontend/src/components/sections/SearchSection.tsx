// The search section of the left column.
//
// The section answers one question: "which note do I look for?". It holds the
// field of the full text search, the results of the search and the filters that
// the user has saved.
//
// The search of the text and the filter of the query language are two
// different things: the first finds a word in the notes, the second asks the
// vault which notes match a condition. The filter itself lives in the section
// Filters, where the query is written; here a short line says that a filter is
// applied and offers to open it.
import { useEffect, useRef, useState } from 'preact/hooks';
import { search } from '../../api/client';
import { useAppActions, useAppState } from '../../core/store/hooks';
import { loadViews, type SavedView } from '../../core/views/types';
import { debounce } from '../../lib/debounce';
import { errorMessage } from '../../lib/errors';
import type { SearchHit } from '../../types';

export interface SearchSectionProps {
  /** Called with the path of the note the user picked. */
  onOpenNote(path: string): void;
  /** Called when the user asks to open the section of the filters. */
  onOpenFilters?(): void;
}

/** The delay of the search, in milliseconds. */
const SEARCH_DELAY = 250;

export function SearchSection(props: SearchSectionProps) {
  const state = useAppState();
  const actions = useAppActions();
  const [text, setText] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [views] = useState<SavedView[]>(() => loadViews());
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  /**
   * Runs the search of the text.
   *
   * The request is aborted when a new one starts: the answers of the older
   * requests are dropped, so the results of the last keystroke are the ones
   * that stay on the screen.
   */
  const run = useRef(
    debounce((value: string) => {
      const id = ++requestId.current;
      if (!value.trim()) {
        setHits([]);
        setLoading(false);
        return;
      }
      controller.current?.abort();
      const next = new AbortController();
      controller.current = next;
      setLoading(true);
      search(value, 50, next.signal)
        .then((result) => {
          if (id !== requestId.current) return;
          setHits(result);
          setError(null);
        })
        .catch((err: unknown) => {
          if (id !== requestId.current) return;
          const code = (err as { code?: string } | null | undefined)?.code;
          if (code === 'aborted') return;
          setError(errorMessage(err));
          setHits([]);
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, SEARCH_DELAY),
  ).current;

  useEffect(() => () => run.cancel(), [run]);

  const onInput = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value;
    setText(value);
    run(value);
  };

  /**
   * Applies a saved filter.
   *
   * The filter belongs to the query language, so it is applied to the query of
   * the store: the tree of the notes is filtered by it, and the number of the
   * matching notes is shown in the section Filters.
   */
  const applyView = (view: SavedView): void => {
    actions.setQuery(view.query);
    void actions.runQuery(view.query);
  };

  return (
    <section class="column-section" aria-label="Search">
      <header class="column-header section-header">
        <span class="section-header-title">Search</span>
        <span class="section-header-count">{hits.length} results</span>
      </header>

      <div class="column-body">
        <div class="section-field">
          <input
            type="search"
            class="section-search-input"
            placeholder="Search notes…"
            aria-label="Search query"
            value={text}
            onInput={onInput}
          />
          {loading ? <span class="search-status">Searching…</span> : null}
          {error ? <p class="error-text">{error}</p> : null}
        </div>

        <ul class="search-results" data-testid="search-results">
          {hits.map((hit) => (
            <li key={`${hit.kind}:${hit.path}:${hit.name}`}>
              <button
                type="button"
                class="search-result"
                onClick={() => props.onOpenNote(hit.path)}
              >
                <span class="search-result-name">{hit.name}</span>
                <span class="search-result-path">{hit.path}</span>
                {hit.snippet ? <span class="search-result-snippet">{hit.snippet}</span> : null}
              </button>
            </li>
          ))}
          {!loading && text.trim() && hits.length === 0 && !error ? (
            <li class="search-empty">No results</li>
          ) : null}
          {!text.trim() && hits.length === 0 ? (
            <li class="search-empty">Type to search in the notes of the vault.</li>
          ) : null}
        </ul>

        {state.ui.query.trim() ? (
          <div class="section-filter-status">
            <p class="section-hint">
              A filter is applied — the tree shows only the matching notes.
            </p>
            {props.onOpenFilters ? (
              <button
                type="button"
                class="q9-button q9-button-quiet"
                onClick={() => props.onOpenFilters?.()}
              >
                Open the filters
              </button>
            ) : null}
          </div>
        ) : null}

        <div class="sidebar-section">
          <div class="sidebar-section-title">
            <span>Saved filters</span>
          </div>
          {views.length === 0 ? (
            <p class="section-hint">
              No saved filter yet. Build one in the section Filters and save it under a name.
            </p>
          ) : (
            <div class="q9-chips">
              {views.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  class="q9-chip q9-chip-saved"
                  title={view.query}
                  onClick={() => applyView(view)}
                >
                  <span class="q9-chip-name">{view.title}</span>
                </button>
              ))}
            </div>
          )}
          {state.ui.queryError ? (
            <p class="q9-query-error" role="alert">
              {state.ui.queryError}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
