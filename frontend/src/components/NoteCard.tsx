// The card of a note.
//
// The card is the small picture of a note: its title, its tags, the way into
// the vault, the dates and the size of its text. It is used where a note is
// shown without being opened — in the search, in the calendar, in a list of
// the recent notes.
//
// The card shows; it does not open the note. The click on the title is the
// business of the caller.
import { buildBreadcrumbs } from './NoteBreadcrumbs';
import { useT } from '../i18n/useT';

export interface NoteCardProps {
  /** The title of the note. */
  title: string;
  /** The path of the note; it gives the breadcrumbs. */
  path?: string;
  /** The tags of the note. */
  tags?: string[];
  /** The moment of the creation of the note (ISO 8601). */
  createdAt?: string | null;
  /** The moment of the last change of the note (ISO 8601). */
  updatedAt?: string | null;
  /** The number of the words of the note. */
  wordCount?: number | null;
  /** Called when the card is clicked. */
  onOpen?(): void;
}

/** The date of a moment, in the short form of the interface. */
function shortDate(value: string | null | undefined): string {
  if (!value) return '';
  const time = Date.parse(value);
  if (Number.isNaN(time)) return '';
  const date = new Date(time);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The word count, with the plural of the interface. */
function words(count: number | null | undefined, one: string, many: string): string {
  if (count === null || count === undefined || count < 0) return '';
  return count === 1 ? one : many;
}

/** The compact card of a note. */
export function NoteCard(props: NoteCardProps) {
  const t = useT();
  const tags = props.tags ?? [];
  const breadcrumbs = buildBreadcrumbs(props.path ?? '').filter((crumb) => !crumb.current);
  const created = shortDate(props.createdAt);
  const updated = shortDate(props.updatedAt);
  const wordCount = words(
    props.wordCount,
    t('noteCard.oneWord'),
    t('noteCard.words', { count: props.wordCount ?? 0 }),
  );

  return (
    <article class="note-card" data-testid="note-card">
      <h3 class="note-card-title">{props.title}</h3>
      {breadcrumbs.length > 0 ? (
        <nav class="note-card-path" aria-label={t('noteCard.path')}>
          {breadcrumbs.map((crumb) => (
            <span key={crumb.path} class="note-card-crumb">
              {crumb.label}
            </span>
          ))}
        </nav>
      ) : null}
      {tags.length > 0 ? (
        <ul class="note-card-tags" aria-label={t('noteCard.tags')}>
          {tags.map((tag) => (
            <li key={tag} class="note-card-tag">
              #{tag}
            </li>
          ))}
        </ul>
      ) : null}
      <footer class="note-card-meta">
        {created ? (
          <span class="note-card-date" title={t('noteCard.createdTitle')}>
            {t('noteCard.created', { date: created })}
          </span>
        ) : null}
        {updated ? (
          <span class="note-card-date" title={t('noteCard.changedTitle')}>
            {t('noteCard.changed', { date: updated })}
          </span>
        ) : null}
        {wordCount ? <span class="note-card-words">{wordCount}</span> : null}
      </footer>
    </article>
  );
}
