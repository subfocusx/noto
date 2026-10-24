// The tags of the open note.
//
// The tags are a derived property of the note: they are read from the text
// (`#word`) with the same rules as the server. The strip makes them visible
// and lets the user add or remove one without typing the `#` by hand.
//
// The strip writes into the text of the note, because the text is the only
// source of truth — in the encrypted storage there is no other place for a
// tag.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
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

/** The name of the group for the assistive technology. */
const GROUP_NAME = 'Tags of the note';

/** The explanation of the strip; it is the tooltip of the label. */
const LABEL_HINT = 'The tags of a note are written in its text as #word.';

/** The placeholder of the field that adds a tag. */
const PLACEHOLDER = 'Add a tag…';

/** The explanation of the field; it is its tooltip. */
const FIELD_HINT = 'The Enter key confirms the tag, the Escape key cancels it.';

/**
 * The strip of the tags of the open note.
 *
 * The strip is always visible when a note is open: it carries the button that
 * adds a tag, so the first tag of a note must be addable too.
 *
 * The row names itself: the label says what the row holds, and the row keeps
 * its own name for the assistive technology. The label itself is decorative —
 * it repeats what the row already says.
 */
export function NoteTags(props: NoteTagsProps) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  // The field is submitted by the Enter key and by the loss of the focus. The
  // loss of the focus happens when the field disappears, so the submission
  // must happen only once: the flag survives the closing of the field.
  const submitted = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const tags = useMemo(() => extractProps(props.content).tags, [props.content]);

  // The field takes the focus as soon as it appears: the user types the name
  // of the tag right away.
  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

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

  // The escape key cancels the field: the loss of the focus that follows must
  // not confirm the tag.
  const cancel = (): void => {
    submitted.current = true;
    setAdding(false);
    setValue('');
  };

  const open = (): void => {
    submitted.current = false;
    setValue('');
    setAdding(true);
  };

  return (
    <div class="q9-note-tags" data-testid="note-tags" role="group" aria-label={GROUP_NAME}>
      <span class="note-tags-label" title={LABEL_HINT} aria-hidden="true">
        <Icon name="tags" size={12} />
        <span class="note-tags-label-text">Tags</span>
      </span>
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
          ref={inputRef}
          type="text"
          class="q9-note-tag-input"
          value={value}
          placeholder={PLACEHOLDER}
          title={FIELD_HINT}
          aria-label="Name of the new tag"
          spellcheck={false}
          onInput={(event) => setValue((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
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
