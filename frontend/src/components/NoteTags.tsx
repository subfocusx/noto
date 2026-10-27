// The tags of the open note.
//
// The tags are a derived property of the note: they are read from the text
// (`#word`) with the same rules as the server. The strip makes them visible
// and lets the user add or remove one without typing the `#` by hand.
//
// The strip writes into the text of the note, because the text is the only
// source of truth — in the encrypted storage there is no other place for a
// tag.
import { useMemo, useState } from 'preact/hooks';
import { extractProps } from '../core/metadata/extract';
import { useT } from '../i18n/useT';
import type { TagCount } from '../types';
import { Icon } from '../ui/icons';
import { TagPickerDialog } from './TagPickerDialog';

export interface NoteTagsProps {
  /** The text of the open note. */
  content: string;
  /** True when the note cannot be edited. */
  readOnly?: boolean;
  /** Adds a tag to the note (the tag is written into the text). */
  onAddTag(tag: string): void;
  /** Removes a tag from the note (the token is cut out of the text). */
  onRemoveTag(tag: string): void;
  /** The tags of the vault: the window of the tags offers them. */
  allTags?: TagCount[];
  /** Called when the window of the tags opens and the list must be read. */
  onRequestTags?(): void;
}

/**
 * The strip of the tags of the open note.
 *
 * The strip is always visible when a note is open: it carries the button that
 * adds a tag, so the first tag of a note must be addable too.
 *
 * The button opens a small window: the window offers the tags of the vault
 * (so the same name is not written twice) and a field for a new one. A field
 * in the strip itself would push the tags of the note out of the row, and
 * the row is a header, not a form.
 *
 * The row names itself: the label says what the row holds, and the row keeps
 * its own name for the assistive technology. The label itself is decorative —
 * it repeats what the row already says.
 */
export function NoteTags(props: NoteTagsProps) {
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);

  const tags = useMemo(() => extractProps(props.content).tags, [props.content]);

  // The window opens the list of the tags of the vault: the list is read when
  // it is needed, not when the application starts.
  const open = (): void => {
    setPickerOpen(true);
    props.onRequestTags?.();
  };

  return (
    <div class="q9-note-tags" data-testid="note-tags" role="group" aria-label={t('tags.group')}>
      <span class="note-tags-label" title={t('tags.hint')} aria-hidden="true">
        <Icon name="tags" size={12} />
        <span class="note-tags-label-text">{t('tags.label')}</span>
      </span>
      {tags.map((tag) => (
        <span key={tag} class="q9-note-tag">
          <span class="q9-note-tag-name">#{tag}</span>
          {props.readOnly ? null : (
            <button
              type="button"
              class="q9-note-tag-x"
              title={t('tags.remove', { tag })}
              aria-label={t('tags.remove', { tag })}
              onClick={() => props.onRemoveTag(tag)}
            >
              <Icon name="x" size={11} />
            </button>
          )}
        </span>
      ))}
      {props.readOnly ? null : (
        <button
          type="button"
          class="q9-note-tag-add"
          title={t('tags.add')}
          aria-label={t('tags.add')}
          onClick={open}
        >
          <Icon name="plus" size={12} />
        </button>
      )}
      <TagPickerDialog
        open={pickerOpen}
        tags={props.allTags ?? []}
        current={tags}
        onPick={(tag) => {
          if (!tags.includes(tag)) props.onAddTag(tag);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
