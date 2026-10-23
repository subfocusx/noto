// The help of the keyboard shortcuts.
//
// The list comes from the single source of truth of the shortcuts, so the
// help can never document a shortcut that does not exist.
import { SHORTCUTS } from '../core/commands/shortcuts';
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
  // The groups keep the order of the definitions.
  const groups: { name: string; items: { label: string; keys: string }[] }[] = [];
  for (const shortcut of SHORTCUTS) {
    let group = groups.find((entry) => entry.name === shortcut.group);
    if (!group) {
      group = { name: shortcut.group, items: [] };
      groups.push(group);
    }
    group.items.push({ label: shortcut.label, keys: displayKeys(shortcut.keys) });
  }

  return (
    <Dialog title="Keyboard shortcuts" open={props.open} onClose={props.onClose}>
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
