// The audit log of the actions of the plugins (API 1.3.0).
//
// Every action of a plugin (open, read, write, command) is recorded here with
// the id of the plugin, the kind of the action, the moment and the target of
// the action. The log never carries the content of a note — only paths,
// counters and identifiers.
//
// The log is a bounded ring buffer: the oldest record is dropped when the
// buffer is full, so the memory of the application stays bounded.
//
// The module is pure: it imports nothing from the application (rule R15) and
// can be used by the host, by the panel of the plugins and by the tests.
import type { PluginAuditAction, PluginAuditEntry } from './contract';

/** The number of the records the log keeps. */
export const PLUGIN_AUDIT_CAPACITY = 500;

/** A callback fired when a record is added to the log. */
export type PluginAuditListener = (entry: PluginAuditEntry) => void;

/**
 * A bounded ring buffer of the actions of the plugins.
 *
 * The newest record is the first one of {@link PluginAuditLog.entries}: the
 * panel shows the last actions at the top.
 */
export class PluginAuditLog {
  /** The ring buffer itself. */
  private readonly buffer: PluginAuditEntry[];
  /** The index of the oldest record. */
  private head = 0;
  /** The number of the records in the buffer. */
  private count = 0;
  /** The listeners of the changes. */
  private readonly listeners = new Set<PluginAuditListener>();

  constructor(readonly capacity: number = PLUGIN_AUDIT_CAPACITY) {
    this.buffer = new Array<PluginAuditEntry>(Math.max(1, capacity));
  }

  /**
   * Records an action of a plugin.
   *
   * @param pluginId the id of the plugin;
   * @param action the kind of the action;
   * @param target the target of the action (a path, a command id, ...);
   * @param at the moment of the action; the current time by default.
   */
  record(
    pluginId: string,
    action: PluginAuditAction,
    target: string,
    at: string = new Date().toISOString(),
  ): PluginAuditEntry {
    const entry: PluginAuditEntry = { pluginId, action, at, target };
    const index = (this.head + this.count) % this.buffer.length;
    this.buffer[index] = entry;
    if (this.count < this.buffer.length) {
      this.count += 1;
    } else {
      // The buffer is full: the oldest record is dropped.
      this.head = (this.head + 1) % this.buffer.length;
    }
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(entry);
      } catch {
        // A broken listener must not break the log.
      }
    }
    return entry;
  }

  /** The records of the log, the newest first. */
  entries(): PluginAuditEntry[] {
    const out: PluginAuditEntry[] = [];
    for (let i = this.count - 1; i >= 0; i -= 1) {
      const entry = this.buffer[(this.head + i) % this.buffer.length];
      if (entry) out.push(entry);
    }
    return out;
  }

  /** The number of the records in the log. */
  get size(): number {
    return this.count;
  }

  /** Drops every record. */
  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /**
   * Subscribes to the changes of the log.
   *
   * @returns an idempotent unsubscribe function.
   */
  subscribe(listener: PluginAuditListener): () => void {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }
}
