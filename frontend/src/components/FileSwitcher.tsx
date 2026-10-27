// The quick file switcher.
//
// The switcher opens a note by its name, the way Obsidian and VS Code do: the
// user types a few letters and the list of the notes of the storage is
// filtered and ranked under the cursor.
//
// The component is a modal dialog: the focus moves into the search field when
// it opens and returns to the trigger when it closes. It is not wired to the
// shell: the host decides when it is open and what it does with the path of
// the note that was chosen.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useT } from '../i18n/useT';
import '../styles/file-switcher.css';

/** One note of the storage, as the switcher needs it. */
export interface SwitcherFile {
  /** The path of the note, relative to the root of the storage. */
  path: string;
  /** The name of the note, without the folders. */
  name: string;
}

export interface FileSwitcherProps {
  /** True when the switcher is shown. */
  open: boolean;
  /** The notes of the storage, as a flat list. */
  files: SwitcherFile[];
  /** Called with the path of the note the user has chosen. */
  onOpen(path: string): void;
  /** Called when the switcher must be closed. */
  onClose(): void;
  /** The text of the field; the default comes from the catalogue. */
  placeholder?: string;
}

/** The id of the list of the options. */
const LIST_ID = 'noto-switcher-list';

/** The number of notes the switcher shows at most. */
const LIMIT = 50;

/** The id of the option with the given index. */
function optionId(index: number): string {
  return `noto-switcher-option-${index}`;
}

/** The two groups of the results: the name of the note, then its path. */
const GROUP_NAMES = 'names';
const GROUP_PATHS = 'paths';

/**
 * The group a note belongs to, or `null` when it does not match.
 *
 * The ranking is the order of the groups: a note whose name begins with the
 * query comes first, then a note whose name holds it, then a note whose path
 * holds it.
 */
function groupOf(file: SwitcherFile, needle: string): string | null {
  const name = file.name.toLowerCase();
  const path = file.path.toLowerCase();
  if (name.startsWith(needle)) return GROUP_NAMES;
  if (name.includes(needle)) return GROUP_NAMES;
  if (path.includes(needle)) return GROUP_PATHS;
  return null;
}

/** The notes that match the query, in the order of the ranking. */
function rank(files: SwitcherFile[], query: string): SwitcherFile[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...files].sort((a, b) => a.name.localeCompare(b.name)).slice(0, LIMIT);
  }
  const names: SwitcherFile[] = [];
  const paths: SwitcherFile[] = [];
  for (const file of files) {
    const group = groupOf(file, needle);
    if (group === GROUP_NAMES) names.push(file);
    else if (group === GROUP_PATHS) paths.push(file);
  }
  const byName = (a: SwitcherFile, b: SwitcherFile): number => a.name.localeCompare(b.name);
  return [...names.sort(byName), ...paths.sort(byName)].slice(0, LIMIT);
}

export function FileSwitcher(props: FileSwitcherProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // The focus moves into the field on open and returns to the trigger on
  // close.
  useEffect(() => {
    if (!props.open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
    return () => {
      previousFocus.current?.focus?.();
    };
  }, [props.open]);

  // Escape closes the switcher even when the focus is not in the field.
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

  const results = useMemo(() => rank(props.files, query), [props.files, query]);
  const current = results.length > 0 ? Math.min(active, results.length - 1) : -1;

  const choose = (file: SwitcherFile): void => {
    props.onOpen(file.path);
    props.onClose();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // The global combinations belong to the shell: the switcher never eats
    // them.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (results.length === 0) return;
      setActive((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      setActive((index) => (index - 1 + results.length) % results.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const file = current >= 0 ? results[current] : undefined;
      if (file) choose(file);
    }
  };

  // The options are rendered in groups: the notes whose name matches first,
  // then the notes that only match by their path.
  const options: ComponentChildren[] = [];
  let lastGroup: string | undefined;
  results.forEach((file, index) => {
    const group = groupOf(file, query.trim().toLowerCase()) ?? GROUP_NAMES;
    if (group !== lastGroup) {
      options.push(
        <li key={`group-${group}`} class="noto-switcher-group" role="presentation">
          {group === GROUP_PATHS ? t('switcher.groupPaths') : t('switcher.groupNotes')}
        </li>,
      );
    }
    lastGroup = group;
    options.push(
      <li
        key={file.path}
        id={optionId(index)}
        role="option"
        class={`noto-switcher-option${index === current ? ' is-active' : ''}`}
        aria-selected={index === current}
        onMouseEnter={() => setActive(index)}
        onClick={() => choose(file)}
      >
        <span class="noto-switcher-option-name">{file.name}</span>
        <span class="noto-switcher-option-path">{file.path}</span>
      </li>,
    );
  });

  if (!props.open) return null;

  return (
    <div
      class="noto-switcher-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        class="noto-switcher"
        role="dialog"
        aria-modal="true"
        aria-label={t('switcher.title')}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          class="noto-switcher-input"
          type="text"
          role="combobox"
          aria-label={t('switcher.search')}
          aria-expanded="true"
          aria-controls={LIST_ID}
          aria-activedescendant={current >= 0 ? optionId(current) : undefined}
          aria-autocomplete="list"
          autocomplete="off"
          spellcheck={false}
          placeholder={props.placeholder ?? t('switcher.placeholder')}
          value={query}
          onInput={(event) => {
            setQuery((event.currentTarget as HTMLInputElement).value);
            setActive(0);
          }}
        />

        <ul class="noto-switcher-list" id={LIST_ID} role="listbox" aria-label={t('switcher.title')}>
          {options}
        </ul>

        {results.length === 0 ? <p class="noto-switcher-empty">{t('switcher.empty')}</p> : null}

        <p class="noto-switcher-hint">{t('switcher.hint')}</p>
      </div>
    </div>
  );
}
