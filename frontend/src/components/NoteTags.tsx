// The tags of the open note.
//
// The tags are a derived property of the note: they are read from the text
// (`#word`) with the same rules as the server. The strip makes them visible
// and lets the user add or remove one without typing the `#` by hand.
//
// The strip writes into the text of the note, because the text is the only
// source of truth — in the encrypted storage there is no other place for a
// tag.
import { useMemo, useRef, useState } from 'preact/hooks';
import { extractProps } from '../core/metadata/extract';
import { Icon } from '../ui/icons';

export interface NoteTagsProps {
  /** The text of the open note. */
  content: string;
  /** True when the note cannot be edited. */
  readOnly?: boolean;
  /** Adds a tag to the note (the tag is written into the text). */
  onAddTag(tag: string): void;
  /** Removes a tag from the note (the token is cut out of the text). */
  onRemoveTag(tag: string): void;
}

/**
 * Normalises a tag: lower case, without the `#`, with the characters the
 * language of the tags allows.
 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_/-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The strip of the tags of the open note.
 *
 * The strip is always visible when a note is open: it carries the button that
 * adds a tag, so the first tag of a note must be addable too.
 */
export function NoteTags(props: NoteTagsProps) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  // The field is submitted by the Enter key and by the loss of the focus. The
  // loss of the focus happens when the field disappears, so the submission
  // must happen only once: the flag survives the closing of the field.
  const submitted = useRef(false);

  const tags = useMemo(() => extractProps(props.content).tags, [props.content]);

  const submit = (): void => {
    if (submitted.current) return;
    submitted.current = true;
    const tag = normalizeTag(value);
    if (!tag) {
      setAdding(false);
      setValue('');
      return;
    }
    if (!tags.includes(tag)) props.onAddTag(tag);
    setValue('');
    setAdding(false);
  };

  const open = (): void => {
    submitted.current = false;
    setValue('');
    setAdding(true);
  };

  return (
    <div class="q9-note-tags" data-testid="note-tags">
      {tags.map((tag) => (
        <span key={tag} class="q9-note-tag">
          <span class="q9-note-tag-name">#{tag}</span>
          {props.readOnly ? null : (
            <button
              type="button"
              class="q9-note-tag-x"
              title={`Remove the tag ${tag}`}
              aria-label={`Remove the tag ${tag}`}
              onClick={() => props.onRemoveTag(tag)}
            >
              <Icon name="x" size={11} />
            </button>
          )}
        </span>
      ))}
      {props.readOnly ? null : adding ? (
        <input
          type="text"
          class="q9-note-tag-input"
          value={value}
          placeholder="tag"
          aria-label="Name of the new tag"
          onInput={(event) => setValue((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setAdding(false);
              setValue('');
            }
          }}
          onBlur={submit}
        />
      ) : (
        <button
          type="button"
          class="q9-note-tag-add"
          title="Add a tag to the note"
          aria-label="Add a tag to the note"
          onClick={open}
        >
          <Icon name="plus" size={12} />
        </button>
      )}
    </div>
  );
}
