// The help of the keyboard shortcuts.
//
// The list comes from the single source of truth of the shortcuts, so the
// help can never document a shortcut that does not exist.
import { SHORTCUTS } from '../core/commands/shortcuts';
import { useT } from '../i18n/useT';
import { Dialog } from './Dialog';

export interface ShortcutHelpProps {
  /** True when the dialog is shown. */
  open: boolean;
  /** Called when the dialog must be closed. */
  onClose(): void;
}

/** The keys of the shortcut, ready to be shown to the user. */
function displayKeys(keys: string): string {
  return keys
    .split('+')
    .map((part) => (part === 'Mod' ? 'Ctrl' : part))
    .join('+');
}

/** The list of the shortcuts of the application, grouped. */
export function ShortcutHelp(props: ShortcutHelpProps) {
  const t = useT();
  // The groups keep the order of the definitions.
  const groups: { name: string; items: { label: string; keys: string }[] }[] = [];
  for (const shortcut of SHORTCUTS) {
    const name = t(`shortcuts.group.${shortcut.group.toLowerCase()}`);
    let group = groups.find((entry) => entry.name === name);
    if (!group) {
      group = { name, items: [] };
      groups.push(group);
    }
    group.items.push({
      label: shortcut.labelKey ? t(shortcut.labelKey) : shortcut.label,
      keys: displayKeys(shortcut.keys),
    });
  }

  return (
    <Dialog title={t('shortcuts.title')} open={props.open} onClose={props.onClose}>
      <div class="shortcut-list">
        {groups.map((group) => (
          <div key={group.name}>
            <h4 class="shortcut-group-title">{group.name}</h4>
            {group.items.map((item) => (
              <div class="shortcut-row" key={item.keys + item.label}>
                <span>{item.label}</span>
                <kbd>{item.keys}</kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
