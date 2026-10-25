// The window of the search and the filters.
//
// The magnifier and the funnel of the rail open one window: the search of the
// text and the filter of the query language are two modules of the same
// instrument, not two sections of the column. The window lives over the
// application — the column of the explorer keeps the tree — and it owns its
// keyboard: Escape closes it, the arrow keys move the selection, Enter opens
// the picked note.
//
// The mode is not a state of the window: the rail and the shortcuts say which
// module the window opens, and the user switches the module with the tabs of
// the window itself.
import { useEffect, useRef, useState } from 'preact/hooks';
import { search } from '../api/client';
import { useAppState } from '../core/store/hooks';
import type { FindMode } from '../core/store/types';
import { debounce } from '../lib/debounce';
import { errorMessage } from '../lib/errors';
import type { SearchHit } from '../types';
import { FilterPanel } from './FilterPanel';

export interface FindPanelProps {
  /** True when the window is shown. */
  open: boolean;
  /** The module the window shows. */
  mode: FindMode;
  /** Called when the user switches the module. */
  onModeChange(mode: FindMode): void;
  /** Called when the window must be closed. */
  onClose(): void;
  /** Called with the path of the note the user picked. */
  onOpenNote(path: string): void;
}

/** The delay of the search, in milliseconds. */
const SEARCH_DELAY = 250;

/** The id of the result with the given index. */
function resultId(index: number): string {
  return `noto-find-result-${index}`;
}

/**
 * The window of the search and the filters.
 *
 * The module of the search keeps the behaviour of the old overlay: the request
 * is debounced, the older request is aborted when a new one starts, the arrow
 * keys move the selection and Enter opens the picked note. The module of the
 * filters reuses the block of the selection of the column and adds the list of
 * the notes that matched, so the user does not have to go back to the tree.
 */
export function FindPanel(props: FindPanelProps) {
  const state = useAppState();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (props.open) {
      setQuery('');
      setHits([]);
      setError(null);
      setSelected(0);
    } else {
      // A closed window must not keep a request running.
      controller.current?.abort();
      controller.current = null;
    }
  }, [props.open]);

  // The focus goes to the field of the module that is shown: the field of the
  // search or the query of the filter.
  useEffect(() => {
    if (!props.open) return;
    const frame = requestAnimationFrame(() => {
      if (props.mode === 'search') {
        input.current?.focus();
        return;
      }
      card.current?.querySelector<HTMLInputElement>('input')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [props.open, props.mode]);

  const run = useRef(
    debounce((value: string) => {
      const id = ++requestId.current;
      if (!value.trim()) {
        setHits([]);
        setLoading(false);
        return;
      }
      // Supersede the previous request instead of racing it.
      controller.current?.abort();
      const next = new AbortController();
      controller.current = next;
      setLoading(true);
      search(value, 50, next.signal)
        .then((result) => {
          if (id !== requestId.current) return;
          setHits(result);
          setError(null);
          setSelected(0);
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
    setQuery(value);
    setSelected(0);
    run(value);
  };

  /** Opens the note of the given hit and closes the window. */
  const open = (hit: SearchHit): void => {
    props.onOpenNote(hit.path);
    props.onClose();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (hits.length === 0) return;
      setSelected((index) => (index + 1) % hits.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (hits.length === 0) return;
      setSelected((index) => (index - 1 + hits.length) % hits.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[selected] ?? hits[0];
      if (hit) open(hit);
    }
  };

  // The notes that matched the query: the store keeps them (they are the
  // notes the tree of the explorer shows). Without a query the list stays
  // empty: it lists what matched, not everything.
  const matching = state.ui.query.trim() ? state.ui.queryHits : [];

  if (!props.open) return null;

  return (
    <div
      class="find-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Search notes"
      onClick={(event) => {
        // A click outside of the window closes it.
        if (event.target === event.currentTarget) props.onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div class="find-window" ref={card}>
        <div class="find-tabs" role="tablist" aria-label="Modules of the window">
          <button
            type="button"
            role="tab"
            class={props.mode === 'search' ? 'find-tab active' : 'find-tab'}
            aria-selected={props.mode === 'search'}
            onClick={() => props.onModeChange('search')}
          >
            Search
          </button>
          <button
            type="button"
            role="tab"
            class={props.mode === 'filters' ? 'find-tab active' : 'find-tab'}
            aria-selected={props.mode === 'filters'}
            onClick={() => props.onModeChange('filters')}
          >
            Filters
          </button>
        </div>

        {props.mode === 'search' ? (
          <div class="find-module" role="tabpanel" aria-label="Search">
            <div class="find-field">
              <input
                ref={input}
                type="search"
                class="find-input"
                placeholder="Search notes…"
                aria-label="Search query"
                aria-controls="noto-find-results"
                aria-activedescendant={hits.length > 0 ? resultId(selected) : undefined}
                value={query}
                onInput={onInput}
                onKeyDown={onKeyDown}
              />
              {loading ? <span class="search-status">Searching…</span> : null}
              {error ? <p class="error-text">{error}</p> : null}
            </div>
            <ul class="search-results" id="noto-find-results" data-testid="search-results">
              {hits.map((hit, index) => (
                <li key={`${hit.kind}:${hit.path}:${hit.name}`}>
                  <button
                    type="button"
                    id={resultId(index)}
                    class="search-result"
                    aria-current={index === selected ? 'true' : undefined}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => open(hit)}
                  >
                    <span class="search-result-name">{hit.name}</span>
                    <span class="search-result-path">{hit.path}</span>
                    {hit.snippet ? <span class="search-result-snippet">{hit.snippet}</span> : null}
                  </button>
                </li>
              ))}
              {!loading && query.trim() && hits.length === 0 && !error ? (
                <li class="search-empty">No results</li>
              ) : null}
              {!query.trim() && hits.length === 0 ? (
                <li class="search-empty">Type to search in the notes of the vault.</li>
              ) : null}
            </ul>
          </div>
        ) : (
          <div class="find-module" role="tabpanel" aria-label="Filters">
            <FilterPanel />
            {matching.length > 0 ? (
              <ul class="find-results" data-testid="find-results">
                {matching.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      class="find-result"
                      onClick={() => {
                        props.onOpenNote(file.path);
                        props.onClose();
                      }}
                    >
                      <span class="find-result-name">{file.name}</span>
                      <span class="find-result-path">{file.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
