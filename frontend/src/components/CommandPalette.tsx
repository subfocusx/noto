// The global command palette.
//
// The palette shows every command of the application and of the plugins: they
// all live in the same `CommandRegistry`. The palette is a modal dialog: the
// focus moves into the search field when it opens and returns to the trigger
// when it closes.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CommandRegistry } from '../core/commands/commandRegistry';
import { useLanguage, useT } from '../i18n/useT';
import { Icon } from '../ui/icons';

export interface CommandPaletteProps {
  /** True when the palette is shown. */
  open: boolean;
  /** The registry the commands are taken from. */
  registry: CommandRegistry | null;
  /** Called when the palette must be closed. */
  onClose(): void;
  /** Called when a command failed. */
  onError?(message: string): void;
  /** Bumped by the host when the content of the registry changes. */
  refreshKey?: number;
  /** The key combination of the commands, by command id. */
  shortcuts?: Record<string, string>;
}

interface PaletteItem {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  icon?: string;
  group?: string;
}

/** The id of the list of the options. */
const LIST_ID = 'noto-palette-list';

/** The id of the option with the given index. */
function optionId(index: number): string {
  return `noto-palette-option-${index}`;
}

/** True when the item matches the query (case insensitive). */
function matches(item: PaletteItem, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  const title = item.title.toLowerCase();
  const description = (item.description ?? '').toLowerCase();
  return title.includes(needle) || description.includes(needle);
}

export function CommandPalette(props: CommandPaletteProps) {
  const t = useT();
  const language = useLanguage();
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  // Set when a command ran: the command may open a dialog of its own, and the
  // focus must not be taken away from it.
  const skipFocusRestore = useRef(false);

  /**
   * The parameters of a title or of a description.
   *
   * A value that starts with `$` is the key of another string: it is
   * translated before it is put into the text.
   */
  const resolveParams = (params?: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(params ?? {})) {
      out[name] = value.startsWith('$') ? t(value.slice(1)) : value;
    }
    return out;
  };

  // The commands are read from the registry every time the palette is opened
  // (and every time the host reports a change).
  useEffect(() => {
    if (!props.open) return;
    const list = props.registry?.list() ?? [];
    setItems(
      list.map((raw) => {
        // A command may carry an icon and a group; the registry only knows the
        // title, the description and the shortcut.
        const cmd = raw as typeof raw & {
          icon?: string;
          group?: string;
          titleKey?: string;
          descriptionKey?: string;
          titleParams?: Record<string, string>;
          descriptionParams?: Record<string, string>;
        };
        return {
          id: cmd.id,
          title: cmd.titleKey
            ? t(cmd.titleKey, resolveParams(cmd.titleParams))
            : cmd.title,
          description: cmd.descriptionKey
            ? t(cmd.descriptionKey, resolveParams(cmd.descriptionParams))
            : cmd.description,
          shortcut: cmd.shortcut,
          icon: cmd.icon,
          group: cmd.group,
        };
      }),
    );
  }, [props.open, props.registry, props.refreshKey, language]);

  // The focus moves into the search field on open and returns to the trigger
  // on close.
  useEffect(() => {
    if (!props.open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    skipFocusRestore.current = false;
    setQuery('');
    setActive(0);
    setError(null);
    inputRef.current?.focus();
    return () => {
      if (skipFocusRestore.current) return;
      previousFocus.current?.focus?.();
    };
  }, [props.open]);

  // Escape closes the palette even when the focus is not in the search field
  // (the focus moves into the field a tick after the palette appears).
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

  const filtered = useMemo(() => items.filter((item) => matches(item, query)), [items, query]);
  const current = filtered.length > 0 ? Math.min(active, filtered.length - 1) : -1;

  const run = async (item: PaletteItem): Promise<void> => {
    setError(null);
    // The focus goes back to the trigger before the command runs: a dialog
    // opened by the command then returns the focus to it when it closes.
    const trigger = previousFocus.current;
    if (trigger?.isConnected) trigger.focus();
    skipFocusRestore.current = true;
    try {
      await props.registry?.run(item.id);
      props.onClose();
    } catch (err) {
      skipFocusRestore.current = false;
      const message = err instanceof Error ? err.message : t('palette.failed');
      setError(message);
      props.onError?.(message);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filtered.length === 0) return;
      setActive((index) => (index + 1) % filtered.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length === 0) return;
      setActive((index) => (index - 1 + filtered.length) % filtered.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = current >= 0 ? filtered[current] : undefined;
      if (item) void run(item);
    }
  };

  // The options are rendered in groups: a group is only shown when the
  // commands carry one.
  const options: ComponentChildren[] = [];
  let lastGroup: string | undefined;
  filtered.forEach((item, index) => {
    if (item.group !== undefined && item.group !== lastGroup) {
      options.push(
        <li key={`group-${item.group}`} class="noto-palette-group" role="presentation">
          {item.group}
        </li>,
      );
    }
    lastGroup = item.group;
    const shortcut = props.shortcuts?.[item.id] ?? item.shortcut;
    options.push(
      <li
        key={item.id}
        id={optionId(index)}
        role="option"
        class={`noto-palette-option${index === current ? ' is-active' : ''}`}
        aria-selected={index === current}
        onMouseEnter={() => setActive(index)}
        onClick={() => {
          void run(item);
        }}
      >
        {item.icon ? <Icon name={item.icon} size={14} class="noto-palette-option-icon" /> : null}
        <span class="noto-palette-option-title">{item.title}</span>
        {item.description ? (
          <span class="noto-palette-option-description">{item.description}</span>
        ) : null}
        {shortcut ? <kbd class="noto-palette-option-shortcut">{shortcut}</kbd> : null}
      </li>,
    );
  });

  if (!props.open) return null;

  return (
    <div
      class="noto-palette-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        class="noto-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          class="noto-palette-input"
          type="text"
          role="combobox"
          aria-label={t('palette.search')}
          aria-expanded="true"
          aria-controls={LIST_ID}
          aria-activedescendant={current >= 0 ? optionId(current) : undefined}
          aria-autocomplete="list"
          autocomplete="off"
          spellcheck={false}
          placeholder={t('palette.placeholder')}
          value={query}
          onInput={(event) => {
            setQuery((event.currentTarget as HTMLInputElement).value);
            setActive(0);
          }}
        />

        {error ? (
          <p class="noto-palette-error" role="alert">
            {error}
          </p>
        ) : null}

        <ul class="noto-palette-list" id={LIST_ID} role="listbox" aria-label={t('palette.commands')}>
          {options}
        </ul>

        {filtered.length === 0 ? (
          <p class="noto-palette-empty">{t('palette.empty')}</p>
        ) : null}
      </div>
    </div>
  );
}
