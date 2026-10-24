// The saved views of the user.
//
// A view is a named query ("Work", "Open tasks"). The list lives in the
// storage of the browser, under its own key, and not in the preferences of
// the application.
import { useState } from 'preact/hooks';
import { useAppActions, useAppState } from '../core/store/hooks';
import { createView, loadViews, saveViews, type SavedView } from '../core/views/types';
import { Icon } from '../ui/icons';

/**
 * The list of the saved views.
 *
 * A view is applied with one click: the query of the view is put in the store
 * and run at once.
 */
export function SavedViews() {
  const state = useAppState();
  const actions = useAppActions();
  const [views, setViews] = useState<SavedView[]>(() => loadViews());
  const [name, setName] = useState('');

  const apply = (view: SavedView): void => {
    actions.setQuery(view.query);
    void actions.runQuery(view.query);
  };

  const save = (): void => {
    const title = name.trim();
    const query = state.ui.query.trim();
    if (!title || !query) return;
    const next = [...views, createView(title, query)];
    setViews(next);
    saveViews(next);
    setName('');
  };

  const remove = (id: string): void => {
    const next = views.filter((view) => view.id !== id);
    setViews(next);
    saveViews(next);
  };

  return (
    <div class="q8-views">
      <div class="q8-subtitle">Views</div>
      {views.length === 0 ? (
        <p class="q8-hint">No saved view yet.</p>
      ) : (
        <ul class="q8-view-list">
          {views.map((view) => (
            <li key={view.id} class="q8-view-row">
              <button
                type="button"
                class="q8-view-apply"
                title={view.query}
                onClick={() => apply(view)}
              >
                {view.title}
              </button>
              <button
                type="button"
                class="icon-button q8-view-delete"
                title={`Delete the view "${view.title}"`}
                aria-label={`Delete the view ${view.title}`}
                onClick={() => remove(view.id)}
              >
                <Icon name="x" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div class="q8-view-save">
        <input
          type="text"
          class="q8-view-name"
          value={name}
          placeholder="Name of the view"
          aria-label="Name of the view"
          onInput={(event) => setName((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            save();
          }}
        />
        <button
          type="button"
          class="q8-button"
          title="Save the current query as a view"
          disabled={!name.trim() || !state.ui.query.trim()}
          onClick={save}
        >
          Save
        </button>
      </div>
    </div>
  );
}
