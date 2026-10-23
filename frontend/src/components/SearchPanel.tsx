import { useEffect, useRef, useState } from 'preact/hooks';
import { search } from '../api/client';
import { debounce, errorMessage } from '../lib/utils';
import type { SearchHit } from '../types';

interface SearchPanelProps {
  open: boolean;
  onClose(): void;
  onOpenNote(path: string): void;
}

/** Search overlay: Ctrl+K / Ctrl+P, 250ms debounce, results with snippet. */
export function SearchPanel(props: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (props.open) {
      setQuery('');
      setHits([]);
      setError(null);
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
    run(value);
  };

  if (!props.open) return null;

  return (
    <div
      class="search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Search notes"
      onKeyDown={(e) => {
        // Escape closes the overlay wherever the focus is.
        if (e.key === 'Escape') props.onClose();
      }}
    >
      <div class="search-box">
        <input
          ref={input}
          type="search"
          class="search-input"
          placeholder="Search notes…"
          aria-label="Search query"
          value={query}
          onInput={onInput}
          onKeyDown={(e) => {
            if (e.key === 'Escape') props.onClose();
            if (e.key === 'Enter' && hits.length > 0) {
              props.onOpenNote(hits[0]!.path);
              props.onClose();
            }
          }}
        />
        {loading ? <span class="search-status">Searching…</span> : null}
        {error ? <p class="error-text">{error}</p> : null}
        <ul class="search-results" data-testid="search-results">
          {hits.map((hit) => (
            <li key={`${hit.kind}:${hit.path}:${hit.name}`}>
              <button
                type="button"
                class="search-result"
                onClick={() => {
                  props.onOpenNote(hit.path);
                  props.onClose();
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
