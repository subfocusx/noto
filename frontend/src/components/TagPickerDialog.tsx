// The window of the tags.
//
// The tags of a note are written in its text, but the names of the tags that
// the vault already uses are known to the server: the window offers them, so
// the user writes the name of a tag once and not twice.
//
// The window is small and modal: it holds one choice (the tag of the note)
// and one field (the name of a tag). The field filters the list while it is
// being written, and the Enter key confirms the tag that is written in it.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useT } from '../i18n/useT';
import { normalizeTag } from '../lib/tags';
import type { TagCount } from '../types';
import { Dialog } from './Dialog';

export interface TagPickerDialogProps {
  /** True when the window is shown. */
  open: boolean;
  /** The tags of the vault with the number of the notes that carry them. */
  tags: TagCount[];
  /** The tags of the note: they are not offered again. */
  current?: string[];
  /** Called when the user chooses a tag. */
  onPick(tag: string): void;
  /** Called when the user closes the window. */
  onClose(): void;
}

/**
 * The window that offers the tags of the vault and accepts a new one.
 */
export function TagPickerDialog(props: TagPickerDialogProps) {
  const t = useT();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The field starts empty every time the window opens: the last name the
  // user wrote belongs to the note it was written for.
  useEffect(() => {
    if (props.open) setValue('');
  }, [props.open]);

  const current = useMemo(() => new Set(props.current ?? []), [props.current]);

  const visible = useMemo(() => {
    const query = value.trim().toLowerCase();
    return props.tags.filter((tag) => {
      if (current.has(tag.tag)) return false;
      if (!query) return true;
      return tag.tag.toLowerCase().includes(query);
    });
  }, [props.tags, value, current]);

  const choose = (tag: string): void => {
    const name = normalizeTag(tag);
    if (!name) return;
    props.onPick(name);
    props.onClose();
  };

  return (
    <Dialog
      title={t('tags.pickerTitle')}
      open={props.open}
      onClose={props.onClose}
      initialFocus={inputRef}
    >
      <div class="tag-picker">
        <input
          ref={inputRef}
          type="text"
          class="tag-picker-input"
          value={value}
          placeholder={t('tags.pickerPlaceholder')}
          title={t('tags.pickerHint')}
          aria-label={t('tags.newName')}
          spellcheck={false}
          onInput={(event) => setValue((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              choose(value);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              props.onClose();
            }
          }}
        />

        {visible.length > 0 ? (
          <ul class="tag-picker-list" data-testid="tag-picker-list">
            {visible.map((tag) => (
              <li key={tag.tag}>
                <button
                  type="button"
                  class="tag-picker-item"
                  title={t('tags.pickerAdd', { tag: tag.tag })}
                  aria-label={t('tags.pickerAdd', { tag: tag.tag })}
                  onClick={() => choose(tag.tag)}
                >
                  <span class="tag-picker-item-name">#{tag.tag}</span>
                  <span class="tag-picker-item-count">{tag.count}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p class="tag-picker-empty">
            {props.tags.length > 0 ? t('tags.pickerAllUsed') : t('tags.pickerEmpty')}
          </p>
        )}
      </div>
    </Dialog>
  );
}
