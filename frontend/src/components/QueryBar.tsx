// The bar of the query language.
//
// The bar holds the query of the user, the number of the notes that match it
// and the errors of the last query. The query lives in the store, so the
// saved views, the tag tree and the plugins see the same one.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useAppActions, useAppState } from '../core/store/hooks';
import { debounce } from '../lib/debounce';
import { Icon } from '../ui/icons';

/** The delay of the query, in milliseconds. */
const QUERY_DELAY = 200;

/** The example shown when the field is empty. */
const PLACEHOLDER = 'tag == "work" && !has_task_list';

/**
 * The bar of the query.
 *
 * The text is debounced: the query runs 200 ms after the last keystroke, and
 * immediately when the user presses Enter.
 */
export function QueryBar() {
  const state = useAppState();
  const actions = useAppActions();
  const [text, setText] = useState(state.ui.query);

  // The query of the store is the reference: it can change outside of the bar
  // (a saved view, a tag of the tree).
  useEffect(() => {
    setText(state.ui.query);
  }, [state.ui.query]);

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

  const hasQuery = state.ui.query.trim().length > 0;

  return (
    <div class="q8-query-bar">
      <div class="q8-query-field">
        <input
          type="text"
          class="q8-query-input"
          value={text}
          placeholder={PLACEHOLDER}
          aria-label="Query"
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
            class="icon-button q8-query-clear"
            title="Clear the query"
            aria-label="Clear the query"
            onClick={clear}
          >
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>
      {hasQuery && !state.ui.queryError ? (
        <span class="q8-query-count" role="status">
          {state.ui.queryTotal} {state.ui.queryTotal === 1 ? 'note' : 'notes'}
        </span>
      ) : null}
      {state.ui.queryPartial ? (
        <p class="q8-query-warning" role="status">
          Some notes could not be checked: the answer may be incomplete.
        </p>
      ) : null}
      {state.ui.queryError ? (
        <p class="q8-query-error" role="alert">
          {state.ui.queryError}
        </p>
      ) : null}
    </div>
  );
}
