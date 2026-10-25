// The section of the favorites.
//
// The section answers one question: "which notes did I keep close?". It lists
// the notes the user marked: the name of the note, its path, and the button
// that opens it.
//
// The mark belongs to the user and not to the file: a note that was deleted
// from the vault stays in the list — with its path — until the user removes
// it. A section that crashed on a deleted note would take the whole column
// with it.
//
// The list lives in the store of the application (see
// `../../core/favorites/types`), so the star of the tree and this section
// always show the same favorites.
import { useMemo } from 'preact/hooks';
import { useAppActions, useAppState } from '../../core/store/hooks';
import { useT } from '../../i18n/useT';
import type { Node } from '../../types';
import { Icon } from '../../ui/icons';

export interface FavoritesSectionProps {
  /** The notes of the vault, to show the name of a favorite. */
  files: Node[];
  /** Called when the user opens a favorite. */
  onOpenNote(path: string): void;
}

/** The name of a note: the name of the file, without its extension. */
function noteName(fileName: string): string {
  return fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName;
}

/**
 * The name of a note that is not in the vault any more.
 *
 * The path is the only thing that is left of a deleted note: its last segment
 * is the name the user knew it by.
 */
function nameOfPath(path: string): string {
  const index = path.lastIndexOf('/');
  const file = index === -1 ? path : path.slice(index + 1);
  return noteName(file);
}

/**
 * The favorites of the user.
 *
 * The section reads the list from the store and writes back through the
 * actions of the store, so the star of the tree sees the same list.
 */
export function FavoritesSection(props: FavoritesSectionProps) {
  const t = useT();
  const state = useAppState();
  const actions = useAppActions();
  const favorites = state.ui.favorites;

  // The tree of the vault knows the name of every note: the favorite takes it
  // from there. A note that is gone keeps only its path.
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of props.files) map.set(file.path, noteName(file.name));
    return map;
  }, [props.files]);

  return (
    <section class="column-section" aria-label={t('section.favorites')}>
      <header class="column-header section-header">
        <span class="section-header-title">{t('section.favorites')}</span>
        <span class="section-header-count">{favorites.length}</span>
      </header>

      <div class="column-body">
        {favorites.length === 0 ? (
          <p class="section-hint">{t('favorites.empty')}</p>
        ) : (
          <ul class="favorites-list">
            {favorites.map((path) => {
              const entry = names.get(path);
              const known = entry !== undefined;
              const name = entry ?? nameOfPath(path);
              return (
                <li key={path} class={`favorite-item${known ? '' : ' is-missing'}`}>
                  <button
                    type="button"
                    class="favorite-open"
                    title={path}
                    onClick={() => props.onOpenNote(path)}
                  >
                    <span class="favorite-name">{name}</span>
                    <span class="favorite-path">{path}</span>
                  </button>
                  <button
                    type="button"
                    class="icon-button favorite-remove"
                    aria-label={t('favorites.remove', { name })}
                    title={t('favorites.remove', { name })}
                    onClick={() => actions.toggleFavorite(path)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
