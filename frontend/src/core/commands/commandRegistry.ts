// Registry of commands contributed by plugins.
//
// The registry lives in `core/` and therefore cannot import from
// `src/plugins/**` (boundary rule R1). The command shape is declared
// structurally here; `PluginCommand` from the plugin contract is
// assignable to it, so the host can pass contract commands straight in.

/** Structural shape of a command (compatible with `PluginCommand`). */
export interface CommandLike {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  run(): void | Promise<void>;
}

interface CommandEntry {
  owner: string;
  cmd: CommandLike;
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandEntry>();

  /**
   * Registers a command under its owner (usually a plugin id).
   *
   * A duplicate id is refused: the existing command stays untouched and the
   * returned function is a no-op.
   *
   * @returns an idempotent unregister function.
   */
  register(owner: string, cmd: CommandLike): () => void {
    if (this.commands.has(cmd.id)) {
      console.warn('[noto:commands] duplicate command id ignored', cmd.id);
      return () => {};
    }
    this.commands.set(cmd.id, { owner, cmd });
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const entry = this.commands.get(cmd.id);
      if (entry && entry.owner === owner) this.commands.delete(cmd.id);
    };
  }

  /** Removes every command registered by the given owner. */
  unregisterAll(owner: string): void {
    for (const [id, entry] of Array.from(this.commands)) {
      if (entry.owner === owner) this.commands.delete(id);
    }
  }

  /**
   * Runs a command by id.
   *
   * @returns the result of `cmd.run()` (possibly a promise), or `undefined`
   * when the command is unknown.
   */
  run(id: string): Promise<void> | void {
    const entry = this.commands.get(id);
    if (!entry) {
      console.warn('[noto:commands] unknown command', id);
      return undefined;
    }
    return entry.cmd.run();
  }

  /** All registered commands, in registration order. */
  list(): CommandLike[] {
    return Array.from(this.commands.values(), (entry) => entry.cmd);
  }

  /** True when a command with that id exists. */
  has(id: string): boolean {
    return this.commands.has(id);
  }

  /** Number of registered commands (optionally filtered by owner). */
  count(owner?: string): number {
    if (owner === undefined) return this.commands.size;
    let n = 0;
    for (const entry of this.commands.values()) if (entry.owner === owner) n += 1;
    return n;
  }
}
