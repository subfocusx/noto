// The rail of the sections.
//
// The rail is the narrow column on the left of the window. It holds the icons
// of the sections of the application and nothing else: the column next to it
// shows the content of the section that is pressed.
//
// The rail is an accordion: exactly one section is open at a time, and the
// rail itself never disappears. The user therefore always sees where the
// sections are, and always knows which one is open.
import type { RailSection } from '../core/store/types';
import { RAIL_SECTIONS } from '../core/commands/appCommands';
import { Icon } from '../ui/icons';

export interface RailProps {
  /** The section that is open in the column. */
  section: RailSection;
  /** Called when the user presses the icon of a section. */
  onSelect(section: RailSection): void;
  /** The theme that is applied to the interface. */
  theme: 'light' | 'dark';
  /** Called when the user asks for the other theme. */
  onToggleTheme(): void;
  /** Called when the user asks for the settings of the application. */
  onOpenSettings(): void;
}

/** A section of the rail: its letter, its icon and its name. */
interface RailEntry {
  /** The identifier of the section. */
  id: RailSection;
  /** The letter shown under the icon; it names the section in one character. */
  letter: string;
  /** The name of the icon of the registry. */
  icon: string;
  /** The name of the section; it is the accessible name of the button. */
  label: string;
}

/**
 * The sections of the rail, in the order they are shown.
 *
 * The order is the order of the work of the user: the notes, the search, the
 * selection, the history, the trash. The list itself lives in the core, so the
 * rail and the command palette always agree.
 */
const SECTIONS: RailEntry[] = RAIL_SECTIONS.map((entry) => ({
  id: entry.id,
  letter: entry.letter,
  icon: entry.icon,
  label: entry.title,
}));

/**
 * The rail of the sections.
 *
 * The pressed section carries `aria-current`, so the assistive technology
 * announces which section of the column is open.
 */
export function Rail(props: RailProps) {
  const themeLabel =
    props.theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme';

  return (
    <nav class="rail" aria-label="Sections">
      <ul class="rail-items">
        {SECTIONS.map((entry) => {
          const active = props.section === entry.id;
          return (
            <li key={entry.id}>
              <button
                type="button"
                class="rail-item"
                aria-current={active ? 'page' : undefined}
                aria-label={entry.label}
                title={`${entry.label} (${entry.letter})`}
                data-section={entry.id}
                data-testid={`rail-${entry.id}`}
                onClick={() => props.onSelect(entry.id)}
              >
                <Icon name={entry.icon} size={17} />
                <span class="rail-letter" aria-hidden="true">
                  {entry.letter}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div class="rail-footer">
        <span class="rail-separator" aria-hidden="true" />
        <button
          type="button"
          class="rail-item"
          aria-label={themeLabel}
          title={themeLabel}
          data-testid="rail-theme"
          onClick={props.onToggleTheme}
        >
          <Icon name={props.theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
        <button
          type="button"
          class="rail-item"
          aria-label="Settings"
          title="Settings"
          data-testid="rail-settings"
          onClick={props.onOpenSettings}
        >
          <Icon name="settings" size={17} />
        </button>
      </div>
    </nav>
  );
}
