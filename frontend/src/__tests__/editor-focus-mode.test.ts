import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../core/commands/commandRegistry';
import {
  FOCUS_MODE_CLASS,
  FOCUS_MODE_COMMAND_ID,
  focusModeClass,
  focusModeCommand,
  initialFocusModeState,
  registerFocusModeCommand,
  toggleFocusMode,
} from '../core/editor/focusMode';

describe('the focus mode', () => {
  it('is off when the application starts', () => {
    expect(initialFocusModeState.active).toBe(false);
    expect(focusModeClass(initialFocusModeState)).toBe('');
  });

  it('comes back when it is toggled twice', () => {
    const on = toggleFocusMode(initialFocusModeState);
    expect(on.active).toBe(true);
    expect(focusModeClass(on)).toBe(FOCUS_MODE_CLASS);
    const off = toggleFocusMode(on);
    expect(off.active).toBe(false);
    expect(focusModeClass(off)).toBe('');
  });

  it('does not change the state it is given', () => {
    const state = { active: false };
    toggleFocusMode(state);
    expect(state.active).toBe(false);
  });

  it('registers a command that toggles the mode', () => {
    const registry = new CommandRegistry();
    let active = false;
    const off = registerFocusModeCommand(registry, {
      isActive: () => active,
      toggle: () => {
        active = !active;
      },
    });

    expect(registry.has(FOCUS_MODE_COMMAND_ID)).toBe(true);
    registry.run(FOCUS_MODE_COMMAND_ID);
    expect(active).toBe(true);
    registry.run(FOCUS_MODE_COMMAND_ID);
    expect(active).toBe(false);

    off();
    expect(registry.has(FOCUS_MODE_COMMAND_ID)).toBe(false);
  });

  it('describes the command in the palette', () => {
    const command = focusModeCommand({ isActive: () => false, toggle: () => undefined });
    expect(command.title).toBe('Focus mode');
    expect(command.description ?? '').not.toBe('');
  });
});
