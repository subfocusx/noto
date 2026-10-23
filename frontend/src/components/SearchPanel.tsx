// The search overlay.
//
// Ctrl+Shift+F opens it; the query is debounced and the results show the name
// of the note, its path and a snippet of the matching text. The overlay owns
// its keyboard: Escape closes it, the arrow keys move the selection and Enter
// opens the selected note.
import { useEffect, useRef, useState } from 'preact/hooks';
import { search } from '../api/client';
import { debounce } from '../lib/debounce';
import { errorMessage } from '../lib/errors';
import type { SearchHit } from '../types';

export interface SearchPanelProps {
  /** True when the overlay is shown. */
  open: boolean;
  /** Called when the overlay must be closed. */
  onClose(): void;
  /** Called with the path of the note the user picked. */
  onOpenNote(path: string): void;
}

/** The id of the result with the given index. */
function resultId(index: number): string {
  return `noto-search-result-${index}`;
}

/**
 * Search overlay: Ctrl+Shift+F, 250ms debounce, results with snippet.
 *
 * Ctrl+K and Ctrl+P open the command palette; the palette itself offers the
 * "Search notes" command.
 */
export function SearchPanel(props: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (props.open) {
      setQuery('');
      setHits([]);
      setError(null);
      setSelected(0);
      requestAnimationFrame(() => input.current?.focus());
    } else {
      // A closed panel must not keep a request running.
      controller.current?.abort();
      controller.current = null;
    }
  }, [props.open]);

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
    }, 250),
  ).current;

  useEffect(() => () => run.cancel(), [run]);

  const onInput = (event: Event) => {
    const value = (event.target as HTMLInputElement).value;
    setQuery(value);
    setSelected(0);
    run(value);
  };

  /** Opens the note of the given hit and closes the overlay. */
  const open = (hit: SearchHit): void => {
    props.onOpenNote(hit.path);
    props.onClose();
  };

  // Escape closes the overlay even when the focus is not in the search field.
  useEffect(() => {
    if (!props.open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.open, props.onClose]);

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

  if (!props.open) return null;

  return (
    <div
      class="search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Search notes"
      onClick={(event) => {
        // A click outside of the search box closes the overlay.
        if (event.target === event.currentTarget) props.onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div class="search-box">
        <input
          ref={input}
          type="search"
          class="search-input"
          placeholder="Search notes…"
          aria-label="Search query"
          aria-controls="noto-search-results"
          aria-activedescendant={hits.length > 0 ? resultId(selected) : undefined}
          value={query}
          onInput={onInput}
          onKeyDown={onKeyDown}
        />
        {loading ? <span class="search-status">Searching…</span> : null}
        {error ? <p class="error-text">{error}</p> : null}
        <ul class="search-results" id="noto-search-results" data-testid="search-results">
          {hits.map((hit, index) => (
            <li key={`${hit.kind}:${hit.path}:${hit.name}`}>
              <button
                type="button"
                id={resultId(index)}
                class="search-result"
                aria-current={index === selected ? 'true' : undefined}
                onMouseEnter={() => setSelected(index)}
                onClick={() => {
                  open(hit);
                }}
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
        </ul>
      </div>
    </div>
  );
}
