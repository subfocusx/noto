// The focus mode: only the editor is left on the screen.
//
// The state of the focus mode is plain data, so it can be tested without a
// browser and shared by the shell and by the command palette.

import type { CommandLike, CommandRegistry } from '../commands/commandRegistry';

/** The id of the command of the focus mode. */
export const FOCUS_MODE_COMMAND_ID = 'app:focus-mode';

/** The class the shell puts on its root when the focus mode is on. */
export const FOCUS_MODE_CLASS = 'noto-focus-mode';

/** The state of the focus mode. */
export interface FocusModeState {
  /** True when the chrome of the application is hidden. */
  active: boolean;
}

/** The state of the focus mode when the application starts. */
export const initialFocusModeState: FocusModeState = { active: false };

/**
 * The state of the focus mode after the user asked for it.
 *
 * The mode is a switch: the same command turns it on and off.
 */
export function toggleFocusMode(state: FocusModeState): FocusModeState {
  return { active: !state.active };
}

/**
 * The class of the root of the application.
 *
 * An empty string when the mode is off: the root keeps its ordinary classes.
 */
export function focusModeClass(state: FocusModeState): string {
  return state.active ? FOCUS_MODE_CLASS : '';
}

/**
 * The command of the focus mode.
 *
 * The command reads the state and changes it through the callbacks: the
 * shell owns the state, the command only asks for a change.
 */
export function focusModeCommand(deps: {
  /** True when the focus mode is on. */
  isActive(): boolean;
  /** Turns the focus mode on or off. */
  toggle(): void;
}): CommandLike {
  return {
    id: FOCUS_MODE_COMMAND_ID,
    title: 'Focus mode',
    titleKey: 'command.focusMode.title',
    description: 'Hide the tree, the panels and the chrome of the application',
    descriptionKey: 'command.focusMode.description',
    run: () => {
      deps.toggle();
    },
  };
}

/**
 * Registers the command of the focus mode in the registry of the commands.
 *
 * @returns an idempotent function that removes the command again.
 */
export function registerFocusModeCommand(
  registry: CommandRegistry,
  deps: { isActive(): boolean; toggle(): void },
): () => void {
  return registry.register('app', focusModeCommand(deps));
}
